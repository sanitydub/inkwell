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

/** True if a title can be the target of a [[link]] (no brackets, pipes, "#" or line breaks). */
export const isLinkableTitle = (title: string) => !!title.trim() && !/[[\]|#\n]/.test(title);

/**
 * Points [[links]] whose target matches `from` (a normalized title) at `to` instead, keeping any
 * "#heading" and "|shown text". Links inside code blocks and inline code are left alone.
 */
export function retargetLinks(markdown: string, from: string, to: string): string {
	let fence: string | null = null;
	return markdown
		.split('\n')
		.map((line) => {
			const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
			if (fence) {
				if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
				return line;
			}
			if (marker) {
				fence = marker;
				return line;
			}
			const code = [...line.matchAll(/`[^`]*`/g)].map((m) => [m.index!, m.index! + m[0].length]);
			return line.replace(linkRegExp(), (whole: string, target: string, shown: string | undefined, offset: number) => {
				if (code.some(([start, end]) => offset < end && offset + whole.length > start)) return whole;
				if (normalizeTitle(linkTarget(target)) !== from) return whole;
				const hash = target.indexOf('#');
				const heading = hash >= 0 ? target.slice(hash).trimEnd() : '';
				return `[[${to}${heading}${shown !== undefined ? `|${shown}` : ''}]]`;
			});
		})
		.join('\n');
}
