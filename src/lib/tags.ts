// Inline #tags, shared by the server (indexing), the editor (highlighting) and the preview (links).
//
// A tag is "#" followed by letters, numbers, "_", "-" or "/" (for nested tags like #project/inkwell),
// with at least one non-digit so "#1" or "#2024" aren't tags. It must start a line or follow
// whitespace or "(", so URL fragments (example.com/#top) and headings ("# Title") don't count.

const BODY = String.raw`[\p{L}\p{N}_\-/]*[\p{L}_\-][\p{L}\p{N}_\-/]*`;
const MAX_LENGTH = 64;

/** A fresh global regex; group 1 is the tag without "#". Fresh each time because global regexes are stateful. */
export const tagRegExp = () => new RegExp(String.raw`(?<=^|[\s(])#(${BODY})`, 'gu');

/** Lowercases and tidies a raw tag; returns null if nothing usable is left. */
export function normalizeTag(raw: string): string | null {
	const tag = raw
		.trim()
		.replace(/^#/, '')
		.toLowerCase()
		.replace(/\/{2,}/g, '/')
		.replace(/^\/+|[/-]+$/g, '');
	return tag && tag.length <= MAX_LENGTH && /[\p{L}_-]/u.test(tag) ? tag : null;
}

/** Markdown with fenced code blocks and inline code blanked out, so tags inside code are ignored. */
function withoutCode(markdown: string): string {
	let fence: string | null = null;
	return markdown
		.split('\n')
		.map((line) => {
			const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
			if (fence) {
				if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
				return '';
			}
			if (marker) {
				fence = marker;
				return '';
			}
			return line.replace(/`[^`]*`/g, ' ');
		})
		.join('\n');
}

/** All distinct tags in a note, sorted. */
export function extractTags(markdown: string): string[] {
	const tags = new Set<string>();
	for (const match of withoutCode(markdown).matchAll(tagRegExp())) {
		const tag = normalizeTag(match[1]);
		if (tag) tags.add(tag);
	}
	return [...tags].sort();
}
