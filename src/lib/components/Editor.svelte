<script lang="ts">
	import { onMount } from 'svelte';
	import { Annotation, EditorState, RangeSetBuilder } from '@codemirror/state';
	import {
		Decoration,
		EditorView,
		MatchDecorator,
		ViewPlugin,
		drawSelection,
		keymap,
		placeholder,
		type DecorationSet,
		type ViewUpdate
	} from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
	import { HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from '@codemirror/language';
	import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
	import { languages } from '@codemirror/language-data';
	import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
	import {
		autocompletion,
		closeBrackets,
		closeBracketsKeymap,
		type Completion,
		type CompletionContext,
		type CompletionResult
	} from '@codemirror/autocomplete';
	import { tags as t } from '@lezer/highlight';
	import { tagRegExp } from '#lib/tags.ts';
	import { linkRegExp, linkTarget } from '#lib/links.ts';
	import { applyFormat, formatKeymap, type FormatCommand } from '#lib/editor-format.ts';

	interface Props {
		value: string;
		readonly?: boolean;
		onchange?: (value: string) => void;
		/** Note titles to suggest after typing "[[". A function so the list stays current. */
		titles?: () => string[];
		/** Called with a link's target title on Ctrl/⌘+click. */
		onopenlink?: (title: string) => void;
	}

	let { value, readonly = false, onchange, titles, onopenlink }: Props = $props();

	let host: HTMLDivElement;
	let view: EditorView | undefined;

	/** Applies a toolbar formatting command and keeps the cursor in the editor. */
	export function format(command: FormatCommand) {
		if (!view) return;
		applyFormat(view, command);
		view.focus();
	}

	export function focus() {
		view?.focus();
	}

	const highlight = HighlightStyle.define([
		{ tag: t.heading1, fontSize: '1.3em', fontWeight: '600' },
		{ tag: t.heading2, fontSize: '1.15em', fontWeight: '600' },
		{ tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '600' },
		{ tag: t.strong, fontWeight: '600' },
		{ tag: t.emphasis, fontStyle: 'italic' },
		{ tag: t.strikethrough, textDecoration: 'line-through' },
		{ tag: t.link, color: 'var(--accent)' },
		{ tag: t.url, color: 'var(--muted)' },
		{ tag: t.quote, color: 'var(--muted)' },
		{ tag: t.monospace, color: 'var(--syn-string)', fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
		{ tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--faint)' },
		{ tag: t.keyword, color: 'var(--syn-keyword)' },
		{ tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
		{ tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
		{ tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-fn)' },
		{ tag: [t.typeName, t.className, t.tagName], color: 'var(--syn-type)' },
		{ tag: t.comment, color: 'var(--faint)', fontStyle: 'italic' }
	]);

	// Highlights #tags, skipping code and links (same rules as the server's tag index).
	const tagMark = Decoration.mark({ class: 'cm-tag' });
	const tagMatcher = new MatchDecorator({
		regexp: tagRegExp(),
		decorate: (add, from, to, _match, view) => {
			if (!inCodeOrLink(view, from)) add(from, to, tagMark);
		}
	});
	const tagHighlighter = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = tagMatcher.createDeco(view);
			}
			update(update: ViewUpdate) {
				this.decorations = tagMatcher.updateDeco(update, this.decorations);
			}
		},
		{ decorations: (plugin) => plugin.decorations }
	);

	// True if the syntax tree says `pos` is inside code, a URL or HTML (and, optionally, a Markdown link).
	// The Markdown parser reads [[Note]] as a link, so wiki-links pass includeLinks = false.
	function inCodeOrLink(view: EditorView, pos: number, includeLinks = true) {
		const pattern = includeLinks ? /Code|URL|Link|HTML/ : /Code|URL|HTML/;
		for (let node: { name: string; parent: unknown } | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent as typeof node) {
			if (pattern.test(node.name)) return true;
		}
		return false;
	}

	// [[Wiki-links]]: highlighted, and Ctrl/⌘+click follows them.
	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const wikiLinkMark = Decoration.mark({
		class: 'cm-wikilink',
		attributes: { title: `${isMac ? '⌘' : 'Ctrl'}+click to open` }
	});
	const wikiLinkMatcher = new MatchDecorator({
		regexp: linkRegExp(),
		decorate: (add, from, to, _match, view) => {
			if (!inCodeOrLink(view, from, false)) add(from, to, wikiLinkMark);
		}
	});
	const wikiLinkHighlighter = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = wikiLinkMatcher.createDeco(view);
			}
			update(update: ViewUpdate) {
				this.decorations = wikiLinkMatcher.updateDeco(update, this.decorations);
			}
		},
		{ decorations: (plugin) => plugin.decorations }
	);

	// The editor writes in the note's sans serif; code blocks keep a monospace font so they line up.
	const codeLine = Decoration.line({ class: 'cm-code-line' });
	function codeLines(view: EditorView): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();
		let last = -1;
		for (const { from, to } of view.visibleRanges) {
			syntaxTree(view.state).iterate({
				from,
				to,
				enter: (node) => {
					if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return;
					for (let pos = node.from; pos <= node.to; ) {
						const line = view.state.doc.lineAt(pos);
						if (line.from > last) builder.add(line.from, line.from, codeLine);
						last = Math.max(last, line.from);
						pos = line.to + 1;
					}
					return false;
				}
			});
		}
		return builder.finish();
	}
	const codeBlockFont = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = codeLines(view);
			}
			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
					this.decorations = codeLines(update.view);
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations }
	);

	// ==Highlights== and <u>underlines</u> look like what they'll become.
	const highlightMark = Decoration.mark({ class: 'cm-md-highlight' });
	const underlineMark = Decoration.mark({ class: 'cm-md-underline' });
	const inlineStyleMatcher = new MatchDecorator({
		regexp: /==(?!=)(?=\S)(?:.*?\S)==(?!=)|<u>.+?<\/u>/g,
		decorate: (add, from, to, match, view) => {
			if (!inCodeOrLink(view, from, false)) add(from, to, match[0].startsWith('==') ? highlightMark : underlineMark);
		}
	});
	const inlineStyles = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = inlineStyleMatcher.createDeco(view);
			}
			update(update: ViewUpdate) {
				this.decorations = inlineStyleMatcher.updateDeco(update, this.decorations);
			}
		},
		{ decorations: (plugin) => plugin.decorations }
	);

	const followLinkOnModClick = EditorView.domEventHandlers({
		mousedown(event, view) {
			if (!(event.metaKey || event.ctrlKey) || !onopenlink) return false;
			const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
			if (pos == null) return false;
			const line = view.state.doc.lineAt(pos);
			for (const match of line.text.matchAll(linkRegExp())) {
				const start = line.from + match.index!;
				if (pos >= start && pos <= start + match[0].length) {
					event.preventDefault();
					onopenlink(linkTarget(match[1]));
					return true;
				}
			}
			return false;
		}
	});

	// Suggests note titles after "[[", and closes the link when one is picked.
	function linkCompletions(context: CompletionContext): CompletionResult | null {
		const typed = context.matchBefore(/\[\[[^[\]|\n]*/);
		if (!typed || !titles) return null;
		const seen = new Set<string>();
		const options: Completion[] = [];
		for (const title of titles()) {
			const key = title.trim().toLowerCase();
			if (!key || seen.has(key)) continue;
			seen.add(key);
			options.push({
				label: title.trim(),
				type: 'text',
				apply: (view, _completion, from, to) => {
					const closed = view.state.sliceDoc(to, to + 2) === ']]';
					const insert = closed ? title.trim() : `${title.trim()}]]`;
					view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + title.trim().length + 2 } });
				}
			});
		}
		return { from: typed.from + 2, options, validFor: /^[^[\]|\n]*$/ };
	}

	const theme = EditorView.theme({
		'.cm-md-highlight': { backgroundColor: 'var(--mark)', borderRadius: '3px' },
		'.cm-md-underline': { textDecoration: 'underline', textUnderlineOffset: '0.2em' },
		'.cm-wikilink': {
			color: 'var(--accent)',
			textDecoration: 'underline',
			textDecorationColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
			textUnderlineOffset: '0.2em'
		},
		'.cm-tooltip': {
			backgroundColor: 'var(--paper)',
			border: '1px solid var(--line)',
			borderRadius: '6px',
			boxShadow: '0 6px 20px rgb(0 0 0 / 0.12)',
			overflow: 'hidden'
		},
		'.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-ui)', fontSize: '0.875rem', maxHeight: '14rem' },
		'.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '0.3rem 0.75rem' },
		'.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
			backgroundColor: 'var(--accent-soft)',
			color: 'var(--ink)'
		},
		'.cm-completionIcon': { display: 'none' },
		'.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600' },
		'.cm-tag': { color: 'var(--accent)', backgroundColor: 'var(--accent-soft)', borderRadius: '3px' },
		'&': { height: '100%', color: 'var(--ink)', backgroundColor: 'transparent', fontSize: '16px' },
		'.cm-code-line': { fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
		'&.cm-focused': { outline: 'none' },
		'.cm-scroller': {
			fontFamily: 'var(--font-ui)',
			lineHeight: '1.7',
			paddingInline: 'var(--gutter)'
		},
		'.cm-content': { padding: '0.25rem 0 40vh', caretColor: 'var(--accent)' },
		'.cm-line': { padding: '0' },
		'.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
		'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
			{ backgroundColor: 'var(--selection)' },
		'.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' },
		'.cm-placeholder': { color: 'var(--faint)' },
		'.cm-searchMatch': { backgroundColor: 'var(--mark)', borderRadius: '2px' },
		'.cm-panels': {
			backgroundColor: 'var(--panel)',
			color: 'var(--ink)',
			fontFamily: 'var(--font-ui)'
		},
		'.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
		'.cm-panel.cm-search input, .cm-panel.cm-search button': { fontSize: '0.85rem' },
		'.cm-textfield': {
			border: '1px solid var(--line)',
			borderRadius: '4px',
			backgroundColor: 'var(--paper)'
		},
		'.cm-button': {
			backgroundImage: 'none',
			backgroundColor: 'var(--paper)',
			border: '1px solid var(--line)',
			borderRadius: '4px'
		}
	});

	onMount(() => {
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					history(),
					drawSelection(),
					indentOnInput(),
					closeBrackets(),
					highlightSelectionMatches(),
					EditorView.lineWrapping,
					markdown({ base: markdownLanguage, codeLanguages: languages }),
					syntaxHighlighting(highlight),
					tagHighlighter,
					wikiLinkHighlighter,
					inlineStyles,
					codeBlockFont,
					followLinkOnModClick,
					autocompletion({ override: [linkCompletions], icons: false }),
					keymap.of([...formatKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
					placeholder('Start writing. Markdown works here.'),
					EditorState.readOnly.of(readonly),
					EditorView.editable.of(!readonly),
					EditorView.contentAttributes.of({ 'aria-label': 'Note text', spellcheck: 'true' }),
					EditorView.updateListener.of((update) => {
						if (!update.docChanged || update.transactions.some((t) => t.annotation(fromOutside))) return;
						onchange?.(update.state.doc.toString());
					}),
					theme
				]
			})
		});
		return () => view?.destroy();
	});

	// Changes made outside the editor (like ticking a checkbox in the preview) are applied as the
	// smallest possible edit, so the cursor stays put and Ctrl+Z undoes them like typing.
	const fromOutside = Annotation.define<boolean>();

	$effect(() => {
		const next = value;
		if (!view) return;
		const current = view.state.doc.toString();
		if (next === current) return;
		let start = 0;
		while (start < next.length && start < current.length && next[start] === current[start]) start++;
		let endCurrent = current.length;
		let endNext = next.length;
		while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
			endCurrent--;
			endNext--;
		}
		view.dispatch({
			changes: { from: start, to: endCurrent, insert: next.slice(start, endNext) },
			annotations: fromOutside.of(true)
		});
	});
</script>

<div class="editor" bind:this={host}></div>

<style>
	.editor {
		height: 100%;
		min-height: 0;
	}
</style>
