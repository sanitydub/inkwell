<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState } from '@codemirror/state';
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
	import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
	import { tags as t } from '@lezer/highlight';
	import { tagRegExp } from '#lib/tags.ts';

	interface Props {
		value: string;
		readonly?: boolean;
		onchange?: (value: string) => void;
	}

	let { value, readonly = false, onchange }: Props = $props();

	let host: HTMLDivElement;
	let view: EditorView | undefined;

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
		{ tag: t.monospace, color: 'var(--syn-string)' },
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
			for (let node: { name: string; parent: unknown } | null = syntaxTree(view.state).resolveInner(from, 1); node; node = node.parent as typeof node) {
				if (/Code|URL|Link|HTML/.test(node.name)) return;
			}
			add(from, to, tagMark);
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

	const theme = EditorView.theme({
		'.cm-tag': { color: 'var(--accent)', backgroundColor: 'var(--accent-soft)', borderRadius: '3px' },
		'&': { height: '100%', color: 'var(--ink)', backgroundColor: 'transparent', fontSize: '15px' },
		'&.cm-focused': { outline: 'none' },
		'.cm-scroller': {
			fontFamily: 'var(--font-mono)',
			lineHeight: '1.75',
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
					keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
					placeholder('Start writing. Markdown works here.'),
					EditorState.readOnly.of(readonly),
					EditorView.editable.of(!readonly),
					EditorView.contentAttributes.of({ 'aria-label': 'Note text', spellcheck: 'true' }),
					EditorView.updateListener.of((update) => {
						if (update.docChanged) onchange?.(update.state.doc.toString());
					}),
					theme
				]
			})
		});
		return () => view?.destroy();
	});
</script>

<div class="editor" bind:this={host}></div>

<style>
	.editor {
		height: 100%;
		min-height: 0;
	}
</style>
