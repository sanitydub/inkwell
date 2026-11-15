// Live view for the Markdown editor, in the spirit of Obsidian's Live Preview: you edit the
// formatted note directly. Markdown symbols are hidden except on the lines the cursor is on,
// bullets become dots, task markers become checkboxes, tables render as tables, and links and
// tags open with a click. The note itself stays plain Markdown.

import { syntaxTree } from '@codemirror/language';
import {
	EditorState,
	StateEffect,
	StateField,
	type Extension,
	type Range
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { linkRegExp, linkTarget } from './links';
import { renderMarkdown } from './markdown';
import { normalizeTag } from './tags';

export interface LivePreviewOptions {
	onOpenLink?: (title: string) => void;
	onOpenTag?: (tag: string) => void;
}

// ---- Focus: the cursor's line only reveals Markdown while the editor has focus ---------------

const setFocused = StateEffect.define<boolean>();

const focusedField = StateField.define<boolean>({
	create: () => false,
	update: (value, tr) => {
		for (const effect of tr.effects) if (effect.is(setFocused)) value = effect.value;
		return value;
	}
});

// ---- Widgets ------------------------------------------------------------------------------

class BulletWidget extends WidgetType {
	eq() {
		return true;
	}
	toDOM() {
		const span = document.createElement('span');
		span.className = 'cm-live-bullet';
		span.textContent = '•';
		return span;
	}
}

class CheckboxWidget extends WidgetType {
	constructor(readonly checked: boolean) {
		super();
	}
	eq(other: CheckboxWidget) {
		return other.checked === this.checked;
	}
	toDOM(view: EditorView) {
		const box = document.createElement('input');
		box.type = 'checkbox';
		box.className = 'cm-live-task';
		box.checked = this.checked;
		box.disabled = view.state.readOnly;
		box.setAttribute('aria-label', this.checked ? 'Mark as not done' : 'Mark as done');
		// Toggling edits the Markdown ("[ ]" ↔ "[x]"); the widget is redrawn from the new text.
		box.addEventListener('mousedown', (e) => e.preventDefault());
		box.addEventListener('click', (e) => {
			e.preventDefault();
			if (view.state.readOnly) return;
			const at = view.posAtDOM(box);
			const mark = view.state.sliceDoc(at + 1, at + 2);
			view.dispatch({ changes: { from: at + 1, to: at + 2, insert: mark === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle' });
		});
		return box;
	}
	ignoreEvent() {
		return true;
	}
}

class RuleWidget extends WidgetType {
	eq() {
		return true;
	}
	toDOM() {
		const span = document.createElement('span');
		span.className = 'cm-live-hr';
		return span;
	}
}

class ImageWidget extends WidgetType {
	constructor(
		readonly src: string,
		readonly alt: string
	) {
		super();
	}
	eq(other: ImageWidget) {
		return other.src === this.src && other.alt === this.alt;
	}
	toDOM() {
		const img = document.createElement('img');
		img.className = 'cm-live-image';
		img.src = this.src;
		img.alt = this.alt;
		img.loading = 'lazy';
		img.draggable = false;
		return img;
	}
	// Clicking the image lets the editor put the cursor there, which reveals its Markdown.
	ignoreEvent() {
		return false;
	}
}

class TableWidget extends WidgetType {
	constructor(readonly source: string) {
		super();
	}
	eq(other: TableWidget) {
		return other.source === this.source;
	}
	toDOM() {
		const div = document.createElement('div');
		div.className = 'cm-live-table';
		// renderMarkdown sanitises with DOMPurify.
		div.innerHTML = renderMarkdown(this.source);
		return div;
	}
	// Clicking the table lets the editor place the cursor there, which reveals the Markdown.
	ignoreEvent() {
		return false;
	}
}

// ---- Building decorations -----------------------------------------------------------------

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const inlineCode = Decoration.mark({ class: 'cm-live-inline-code' });

function isCode(state: EditorState, pos: number): boolean {
	for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
		if (/Code|HTMLBlock/.test(node.name)) return true;
	}
	return false;
}

function build(state: EditorState): DecorationSet {
	const { doc } = state;
	const focused = state.field(focusedField, false) ?? false;
	const activeLines = new Set<number>();
	if (focused) {
		for (const range of state.selection.ranges) {
			for (let n = doc.lineAt(range.from).number; n <= doc.lineAt(range.to).number; n++) activeLines.add(n);
		}
	}
	const isActive = (from: number, to = from) => {
		if (!focused) return false;
		for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) if (activeLines.has(n)) return true;
		return false;
	};

	const out: Range<Decoration>[] = [];
	const hide = (from: number, to: number) => {
		if (to > from) out.push(hidden.range(from, to));
	};
	const lineClass = (pos: number, className: string) =>
		out.push(Decoration.line({ class: className }).range(doc.lineAt(pos).from));
	const spaceAfter = (pos: number) => (doc.sliceString(pos, pos + 1) === ' ' ? pos + 1 : pos);

	syntaxTree(state).iterate({
		enter: (ref) => {
			const node = ref.node;
			const { name, from, to } = node;
			const parent = node.parent?.name ?? '';

			const heading = /^ATXHeading(\d)$/.exec(name);
			if (heading) {
				lineClass(from, `cm-live-h${heading[1]}`);
				return;
			}
			switch (name) {
				case 'HeaderMark':
					if (parent.startsWith('ATXHeading') && !isActive(from)) {
						// Opening "## " (with its space) or closing " ##".
						if (from === doc.lineAt(from).from || doc.sliceString(doc.lineAt(from).from, from).trim() === '') hide(from, spaceAfter(to));
						else hide(doc.sliceString(from - 1, from) === ' ' ? from - 1 : from, to);
					}
					return;
				case 'EmphasisMark':
				case 'StrikethroughMark':
					if (!isActive(from)) hide(from, to);
					return;
				case 'InlineCode':
					out.push(inlineCode.range(from, to));
					return;
				case 'CodeMark':
					if (parent === 'InlineCode' && !isActive(from)) hide(from, to);
					return;
				case 'FencedCode':
				case 'CodeBlock': {
					for (let pos = from; pos <= to; ) {
						const line = doc.lineAt(pos);
						const fence = name === 'FencedCode' && (line.from === from || line.to === to) && /^\s*(`{3,}|~{3,})/.test(line.text);
						lineClass(line.from, fence ? 'cm-live-codeblock cm-live-fence' : 'cm-live-codeblock');
						pos = line.to + 1;
					}
					return false;
				}
				case 'QuoteMark':
					lineClass(from, 'cm-live-quote');
					if (!isActive(from)) hide(from, spaceAfter(to));
					return;
				case 'ListMark': {
					const item = node.parent;
					const isBullet = /^[-*+]$/.test(doc.sliceString(from, to));
					if (!isBullet || isActive(from)) return;
					if (item?.getChild('Task')) hide(from, spaceAfter(to));
					else out.push(bullet.range(from, to));
					return;
				}
				case 'TaskMarker': {
					const checked = /\[[xX]\]/.test(doc.sliceString(from, to));
					if (checked) lineClass(from, 'cm-live-done');
					if (!isActive(from)) out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(from, to));
					return;
				}
				case 'HorizontalRule':
					if (!isActive(from)) out.push(rule.range(from, to));
					return;
				case 'Link': {
					// [[Wiki-links]] are handled below; the parser sees their inside as a Markdown link.
					if (doc.sliceString(from - 1, from) === '[' && doc.sliceString(to, to + 1) === ']') return false;
					const marks = node.getChildren('LinkMark');
					const url = node.getChild('URL');
					if (isActive(from, to) || marks.length < 2 || !url) return;
					const href = doc.sliceString(url.from, url.to);
					hide(marks[0].from, marks[0].to);
					hide(marks[1].from, to);
					if (marks[1].from > marks[0].to) {
						out.push(
							Decoration.mark({ class: 'cm-live-link', attributes: { 'data-live-href': href, title: href } }).range(
								marks[0].to,
								marks[1].from
							)
						);
					}
					return;
				}
				case 'URL':
					if (parent !== 'Link' && parent !== 'Image' && parent !== 'Autolink') {
						const href = doc.sliceString(from, to);
						out.push(Decoration.mark({ class: 'cm-live-link', attributes: { 'data-live-href': href } }).range(from, to));
					}
					return;
				case 'Image': {
					const url = node.getChild('URL');
					const marks = node.getChildren('LinkMark');
					if (isActive(from, to) || !url || marks.length < 2) return false;
					const src = doc.sliceString(url.from, url.to);
					const alt = doc.sliceString(marks[0].to, marks[1].from);
					if (src.startsWith('/api/attachments/')) {
						// Your own uploads show as pictures.
						out.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(from, to));
					} else {
						// Images on other sites aren't loaded (opening a note never contacts outside servers);
						// they show as a link instead.
						hide(from, marks[0].to);
						hide(marks[1].from, to);
						out.push(
							Decoration.mark({ class: 'cm-live-link', attributes: { 'data-live-href': src, title: src } }).range(
								marks[0].to,
								Math.max(marks[0].to, marks[1].from)
							)
						);
					}
					return false;
				}
				case 'Escape':
				case 'HardBreak':
					// "\*" shows as "*"; a backslash line break shows as just the break.
					if (!isActive(from)) hide(from, from + 1);
					return;
				case 'HTMLTag':
					if (/^<\/?u>$/i.test(doc.sliceString(from, to)) && !isActive(from)) hide(from, to);
					return;
				case 'Table':
					if (!isActive(from, to)) {
						const first = doc.lineAt(from);
						const last = doc.lineAt(to);
						out.push(
							Decoration.replace({ widget: new TableWidget(doc.sliceString(first.from, last.to)), block: true }).range(
								first.from,
								last.to
							)
						);
					}
					return false;
			}
		}
	});

	// Syntax the Markdown parser doesn't know: [[wiki-links]] and ==highlights==.
	for (let n = 1; n <= doc.lines; n++) {
		if (activeLines.has(n)) continue;
		const line = doc.line(n);
		if (!line.text.includes('[[') && !line.text.includes('==')) continue;
		for (const m of line.text.matchAll(linkRegExp())) {
			const start = line.from + m.index!;
			if (isCode(state, start)) continue;
			const end = start + m[0].length;
			const textFrom = m[2] !== undefined ? start + 2 + m[1].length + 1 : start + 2;
			hide(start, textFrom);
			hide(end - 2, end);
			out.push(
				Decoration.mark({ class: 'cm-live-wikilink', attributes: { 'data-live-title': linkTarget(m[1]) } }).range(
					textFrom,
					end - 2
				)
			);
		}
		for (const m of line.text.matchAll(/==(?!=)(?=\S)(?:.*?\S)==(?!=)/g)) {
			const start = line.from + m.index!;
			if (isCode(state, start)) continue;
			hide(start, start + 2);
			hide(start + m[0].length - 2, start + m[0].length);
		}
	}

	return Decoration.set(out, true);
}

const decorations = StateField.define<DecorationSet>({
	create: (state) => build(state),
	update(value, tr) {
		const focusChanged = tr.effects.some((e) => e.is(setFocused));
		if (tr.docChanged || tr.selection || focusChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
			return build(tr.state);
		}
		return value;
	},
	provide: (field) => EditorView.decorations.from(field)
});

// ---- Clicks on links and tags -------------------------------------------------------------

function clickHandler(options: LivePreviewOptions) {
	return EditorView.domEventHandlers({
		mousedown(event, view) {
			if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
			const target = (event.target as HTMLElement).closest<HTMLElement>('[data-live-href], [data-live-title], .cm-tag');
			if (!target) return false;
			// On the line being edited, a click places the cursor like normal.
			const line = view.state.doc.lineAt(view.posAtDOM(target)).number;
			const editing =
				view.hasFocus &&
				view.state.selection.ranges.some(
					(r) => view.state.doc.lineAt(r.from).number <= line && line <= view.state.doc.lineAt(r.to).number
				);
			if (editing) return false;

			event.preventDefault();
			if (target.dataset.liveHref) {
				const href = target.dataset.liveHref;
				if (/^(https?:|mailto:)/i.test(href) || href.startsWith('/api/attachments/')) {
					window.open(href, '_blank', 'noopener,noreferrer');
				}
			} else if (target.dataset.liveTitle) {
				options.onOpenLink?.(target.dataset.liveTitle);
			} else {
				const tag = normalizeTag(target.textContent ?? '');
				if (tag) options.onOpenTag?.(tag);
			}
			return true;
		}
	});
}

// ---- Styles -------------------------------------------------------------------------------

const theme = EditorView.theme({
	'.cm-line.cm-live-h1': { fontSize: '1.7em', fontWeight: '700', lineHeight: '1.3', paddingTop: '0.35em' },
	'.cm-line.cm-live-h2': { fontSize: '1.4em', fontWeight: '650', lineHeight: '1.35', paddingTop: '0.3em' },
	'.cm-line.cm-live-h3': { fontSize: '1.2em', fontWeight: '650', paddingTop: '0.2em' },
	'.cm-line.cm-live-h4, .cm-line.cm-live-h5, .cm-line.cm-live-h6': { fontWeight: '650' },
	'.cm-line.cm-live-quote': {
		borderLeft: '2px solid var(--line)',
		paddingLeft: '0.9em',
		color: 'var(--muted)',
		fontStyle: 'italic'
	},
	'.cm-line.cm-live-codeblock': { backgroundColor: 'var(--code-bg)', paddingInline: '0.8em' },
	'.cm-line.cm-live-fence': { color: 'var(--faint)', fontSize: '0.8em' },
	'.cm-line.cm-live-done': { color: 'var(--muted)' },
	'.cm-live-inline-code': { backgroundColor: 'var(--code-bg)', borderRadius: '4px', padding: '0.1em 0.25em' },
	'.cm-live-bullet': { display: 'inline-block', width: '1.1em', color: 'var(--ink)', textAlign: 'center', fontWeight: '700' },
	'.cm-live-task': {
		margin: '0 0.5em 0 0.1em',
		verticalAlign: '-0.12em',
		accentColor: 'var(--accent)',
		cursor: 'pointer'
	},
	'.cm-live-hr': {
		display: 'inline-block',
		width: '100%',
		height: '0',
		verticalAlign: 'middle',
		borderTop: '1px solid var(--line)'
	},
	'.cm-live-link, .cm-live-wikilink': {
		color: 'var(--accent)',
		textDecoration: 'underline',
		textDecorationThickness: '1px',
		textUnderlineOffset: '0.15em',
		cursor: 'pointer'
	},
	'.cm-tag': { cursor: 'pointer' },
	'.cm-live-image': {
		display: 'block',
		maxWidth: '100%',
		maxHeight: '70vh',
		margin: '0.4em 0',
		borderRadius: '6px'
	},
	'.cm-live-table': { padding: '0.3em 0', overflowX: 'auto', fontSize: '0.9em' },
	'.cm-live-table table': { borderCollapse: 'collapse' },
	'.cm-live-table th, .cm-live-table td': {
		border: '1px solid var(--line)',
		padding: '0.35em 0.7em',
		textAlign: 'left'
	},
	'.cm-live-table th': { backgroundColor: 'var(--panel)', fontWeight: '600' }
});

/** The live view, as one extension. */
export function livePreview(options: LivePreviewOptions = {}): Extension {
	return [
		focusedField,
		EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
		decorations,
		clickHandler(options),
		theme
	];
}
