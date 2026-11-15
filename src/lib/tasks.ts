// Task-list items ("- [ ] Buy seeds") in note Markdown, so the preview's checkboxes can tick them.
// Mirrors marked's GFM rule: "[ ]" or "[x]" right after a list marker, then whitespace and some text.

import { withoutCode } from './tags';

const TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\](?=[ \t]+\S)/;

export interface TaskMark {
	/** Offset of the character between the brackets (" " or "x"). */
	offset: number;
	checked: boolean;
}

/** Every task item in document order, ignoring code blocks. */
export function findTasks(markdown: string): TaskMark[] {
	const tasks: TaskMark[] = [];
	const original = markdown.split('\n');
	// withoutCode keeps lines 1:1 and blanks fenced code, so line i in both arrays is the same line.
	const cleaned = withoutCode(markdown).split('\n');
	let lineStart = 0;
	for (let i = 0; i < original.length; i++) {
		const match = TASK_LINE.exec(cleaned[i] ?? '');
		if (match) tasks.push({ offset: lineStart + match[1].length + 1, checked: match[2] !== ' ' });
		lineStart += original[i].length + 1;
	}
	return tasks;
}
