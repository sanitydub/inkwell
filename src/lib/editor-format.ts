// Formatting commands for the Markdown editor (toolbar buttons and shortcuts). They edit the
// Markdown text directly, so notes stay plain Markdown: underline is <u>…</u> and highlight is
// ==…==, the two things Markdown itself has no syntax for.

import { EditorSelection, type ChangeSpec, type EditorState, type Line } from '@codemirror/state';
import type { EditorView, KeyBinding } from '@codemirror/view';

export type FormatCommand =
	| 'bold'
	| 'italic'
	| 'underline'
	| 'strike'
	| 'highlight'
	| 'code'
	| 'heading'
	| 'h1'
	| 'h2'
	| 'h3'
	| 'bullet'
	| 'numbered'
	| 'task'
	| 'quote'
	| 'link'
	| 'table';

const WRAPS = {
	bold: ['**', '**'],
	italic: ['*', '*'],
	underline: ['<u>', '</u>'],
	strike: ['~~', '~~'],
	highlight: ['==', '=='],
	code: ['`', '`']
} as const;

type WrapCommand = keyof typeof WRAPS;

// ---- Inline wrapping ------------------------------------------------------------------------

/** How many times `char` repeats immediately before `pos` (backwards) or after it (forwards). */
function run(state: EditorState, pos: number, char: string, forwards: boolean): number {
	let n = 0;
	for (;;) {
		const at = forwards ? pos + n : pos - n - 1;
		if (at < 0 || at >= state.doc.length || state.doc.sliceString(at, at + 1) !== char) return n;
		n++;
	}
}

/** True if from..to is wrapped in these markers. For "*" and "**", bold and italic are told apart. */
function isWrapped(state: EditorState, from: number, to: number, before: string, after: string): boolean {
	if (before === '*' || before === '**') {
		const left = run(state, from, '*', false);
		const right = run(state, to, '*', true);
		if (left !== right) return false;
		return before === '*' ? left % 2 === 1 : left >= 2;
	}
	return (
		from >= before.length &&
		state.doc.sliceString(from - before.length, from) === before &&
		state.doc.sliceString(to, to + after.length) === after
	);
}

function toggleWrap(view: EditorView, command: WrapCommand) {
	const [before, after] = WRAPS[command];
	const { state } = view;
	const spec = state.changeByRange((range) => {
		let from = range.from;
		let to = range.to;

		// No selection: work on the word under the cursor, or insert empty markers.
		if (range.empty) {
			const word = state.wordAt(range.head);
			if (!word) {
				return {
					changes: { from, insert: before + after },
					range: EditorSelection.cursor(from + before.length)
				};
			}
			from = word.from;
			to = word.to;
		} else {
			// Markers hug the text, not surrounding spaces.
			while (from < to && /\s/.test(state.doc.sliceString(from, from + 1))) from++;
			while (to > from && /\s/.test(state.doc.sliceString(to - 1, to))) to--;
		}

		// Already formatted: remove the markers around it.
		if (isWrapped(state, from, to, before, after)) {
			const shift = (pos: number) => (pos <= from ? Math.max(pos - before.length, from - before.length) : pos - before.length);
			return {
				changes: [
					{ from: from - before.length, to: from },
					{ from: to, to: to + after.length }
				],
				range: range.empty ? EditorSelection.cursor(shift(range.head)) : EditorSelection.range(from - before.length, to - before.length)
			};
		}
		// The selection includes the markers: remove them.
		const text = state.doc.sliceString(from, to);
		if (!range.empty && text.length >= before.length + after.length && text.startsWith(before) && text.endsWith(after)) {
			return {
				changes: { from, to, insert: text.slice(before.length, text.length - after.length) },
				range: EditorSelection.range(from, to - before.length - after.length)
			};
		}
		return {
			changes: [
				{ from, insert: before },
				{ from: to, insert: after }
			],
			range: range.empty
				? EditorSelection.cursor(range.head + before.length)
				: EditorSelection.range(from + before.length, to + before.length)
		};
	});
	view.dispatch({ ...spec, scrollIntoView: true, userEvent: 'input.format' });
}

// ---- Line formats ---------------------------------------------------------------------------

type LineKind = 'bullet' | 'numbered' | 'task' | 'quote';

const LIST_MARKER = /^(\s*)((?:[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+)?/;

function lineKind(text: string): LineKind | null {
	if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(text)) return 'task';
	if (/^\s*[-*+]\s/.test(text)) return 'bullet';
	if (/^\s*\d+[.)]\s/.test(text)) return 'numbered';
	if (/^\s*>/.test(text)) return 'quote';
	return null;
}

/** The lines touched by the selection; blank lines are skipped unless that's all there is. */
function selectedLines(state: EditorState): Line[] {
	const seen = new Set<number>();
	const lines: Line[] = [];
	for (const range of state.selection.ranges) {
		for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) {
			if (seen.has(n)) continue;
			seen.add(n);
			lines.push(state.doc.line(n));
		}
	}
	const nonBlank = lines.filter((l) => l.text.trim());
	return nonBlank.length ? nonBlank : lines;
}

/**
 * Applies line-prefix changes and moves cursors that sat at an insertion point to after the new
 * marker. (By default the cursor stays in front of inserted text, so typing would land before "- ".)
 */
function dispatchLineChanges(view: EditorView, changes: ChangeSpec[]) {
	const changeSet = view.state.changes(changes);
	view.dispatch({
		changes: changeSet,
		selection: view.state.selection.map(changeSet, 1),
		scrollIntoView: true,
		userEvent: 'input.format'
	});
}

function toggleLineKind(view: EditorView, kind: LineKind) {
	const { state } = view;
	const lines = selectedLines(state);
	const removing = lines.every((l) => lineKind(l.text) === kind);
	const changes = lines.map((line, i) => {
		if (kind === 'quote') {
			const quote = /^(\s*)>\s?/.exec(line.text);
			if (removing && quote) return { from: line.from + quote[1].length, to: line.from + quote[0].length };
			return { from: line.from, insert: '> ' };
		}
		const [marker, indent] = LIST_MARKER.exec(line.text) as RegExpExecArray;
		const insert = removing ? '' : kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${i + 1}. `;
		return { from: line.from + indent.length, to: line.from + marker.length, insert };
	});
	dispatchLineChanges(view, changes);
}

/** Sets the heading level of the selected lines; `cycle` steps H1 → H2 → H3 → normal text. */
function setHeading(view: EditorView, level: number | 'cycle') {
	const { state } = view;
	const lines = selectedLines(state);
	const current = (line: Line) => /^(#{1,6})\s/.exec(line.text)?.[1].length ?? 0;
	const first = current(lines[0]);
	const next = level === 'cycle' ? (first >= 3 ? 0 : first + 1) : first === level ? 0 : level;
	const changes = lines.map((line) => {
		const existing = /^#{1,6}\s+/.exec(line.text)?.[0] ?? '';
		return { from: line.from, to: line.from + existing.length, insert: next ? `${'#'.repeat(next)} ` : '' };
	});
	dispatchLineChanges(view, changes);
}

// ---- Blocks and links -----------------------------------------------------------------------

function insertLink(view: EditorView) {
	const { state } = view;
	const spec = state.changeByRange((range) => {
		const text = state.doc.sliceString(range.from, range.to);
		if (/^https?:\/\/\S+$/.test(text)) {
			// A URL was selected: make it the target and put the cursor where the link text goes.
			return { changes: { from: range.from, to: range.to, insert: `[](${text})` }, range: EditorSelection.cursor(range.from + 1) };
		}
		const label = text || 'link text';
		const insert = `[${label}](https://)`;
		const urlStart = range.from + label.length + 3;
		return {
			changes: { from: range.from, to: range.to, insert },
			// With text selected, select the URL to paste over; otherwise select the placeholder text.
			range: text
				? EditorSelection.range(urlStart, urlStart + 'https://'.length)
				: EditorSelection.range(range.from + 1, range.from + 1 + label.length)
		};
	});
	view.dispatch({ ...spec, scrollIntoView: true, userEvent: 'input.format' });
}

function toggleCode(view: EditorView) {
	const { state } = view;
	const range = state.selection.main;
	if (state.doc.lineAt(range.from).number === state.doc.lineAt(range.to).number) return toggleWrap(view, 'code');
	// Several lines: a fenced code block around whole lines.
	const first = state.doc.lineAt(range.from);
	const last = state.doc.lineAt(range.to);
	view.dispatch({
		changes: [
			{ from: first.from, insert: '```\n' },
			{ from: last.to, insert: '\n```' }
		],
		scrollIntoView: true,
		userEvent: 'input.format'
	});
}

function insertTable(view: EditorView) {
	const { state } = view;
	const line = state.doc.lineAt(state.selection.main.head);
	const lead = line.text.trim() ? '\n\n' : line.number > 1 && state.doc.line(line.number - 1).text.trim() ? '\n' : '';
	const table = '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |';
	const at = line.text.trim() ? line.to : line.from;
	const start = at + lead.length + 2;
	view.dispatch({
		changes: { from: at, to: line.text.trim() ? at : line.to, insert: lead + table },
		selection: EditorSelection.range(start, start + 'Column 1'.length),
		scrollIntoView: true,
		userEvent: 'input.format'
	});
}

// ---- Entry points ---------------------------------------------------------------------------

export function applyFormat(view: EditorView, command: FormatCommand) {
	if (view.state.readOnly) return;
	switch (command) {
		case 'bold':
		case 'italic':
		case 'underline':
		case 'strike':
		case 'highlight':
			return toggleWrap(view, command);
		case 'code':
			return toggleCode(view);
		case 'heading':
			return setHeading(view, 'cycle');
		case 'h1':
			return setHeading(view, 1);
		case 'h2':
			return setHeading(view, 2);
		case 'h3':
			return setHeading(view, 3);
		case 'bullet':
		case 'numbered':
		case 'task':
		case 'quote':
			return toggleLineKind(view, command);
		case 'link':
			return insertLink(view);
		case 'table':
			return insertTable(view);
	}
}

/** Keyboard shortcuts. Lists and headings use the same keys as Google Docs. */
export const SHORTCUTS: Partial<Record<FormatCommand, string>> = {
	bold: 'Mod-b',
	italic: 'Mod-i',
	underline: 'Mod-u',
	strike: 'Mod-Shift-x',
	highlight: 'Mod-Shift-h',
	code: 'Mod-e',
	h1: 'Mod-Alt-1',
	h2: 'Mod-Alt-2',
	h3: 'Mod-Alt-3',
	bullet: 'Mod-Shift-8',
	numbered: 'Mod-Shift-7',
	task: 'Mod-Shift-9',
	link: 'Mod-k'
};

export const formatKeymap: KeyBinding[] = Object.entries(SHORTCUTS).map(([command, key]) => ({
	key,
	run: (view) => {
		applyFormat(view, command as FormatCommand);
		return true;
	}
}));

/** A shortcut as people read it on this platform, e.g. "Ctrl+Shift+8" or "⌘⇧8". */
export function shortcutLabel(command: FormatCommand): string | null {
	const key = SHORTCUTS[command];
	if (!key) return null;
	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const parts = key.split('-');
	const last = parts.pop()!.toUpperCase();
	const names = parts.map((p) => (mac ? { Mod: '⌘', Shift: '⇧', Alt: '⌥' } : { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt' })[p as 'Mod']);
	return mac ? names.join('') + last : [...names, last].join('+');
}
