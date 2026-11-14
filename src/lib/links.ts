// [[Wiki-links]] between notes, shared by the server (backlink index), editor and preview.
//
// [[Target]] links to the note titled "Target"; [[Target|shown text]] displays different text.
// Matching is by title, ignoring case and extra spaces. Anything after "#" in the target
// (Obsidian's [[Note#Heading]]) is ignored when matching.

import { withoutCode } from './tags';

/** A fresh global regex. Group 1 is the target, group 2 the optional display text. */
export const linkRegExp = () => /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g;

/** The note title a link's target points at. */
export const linkTarget = (raw: string) => raw.split('#')[0].trim();

/** The form titles and link targets are compared in. */
export const normalizeTitle = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();

/** Distinct normalized link targets in a note, ignoring code. */
export function extractLinks(markdown: string): string[] {
	const targets = new Set<string>();
	for (const match of withoutCode(markdown).matchAll(linkRegExp())) {
		const target = normalizeTitle(linkTarget(match[1]));
		if (target) targets.add(target);
	}
	return [...targets].sort();
}

/** Text with each [[link]] replaced by what it displays, e.g. for one-line previews. */
export const linksAsText = (text: string) =>
	text.replace(linkRegExp(), (_m, target: string, shown?: string) => (shown ?? target).trim());
