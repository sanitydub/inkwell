import { linksAsText } from './links';

// Backslash-escaped punctuation (like "5 \* 3") is literal text, not formatting. It's swapped
// for a placeholder while formatting is stripped, then put back.
const ESCAPED = /\\([\\`*_{}[\]()#+\-.!<>~|])/g;
const PLACEHOLDER = /(\d+)/g;

/** Plain-text preview of a Markdown note for the note list. */
export function snippetFrom(markdown: string, max = 140): string {
	const literals: string[] = [];
	const text = linksAsText(markdown.slice(0, 1200))
		.replace(ESCAPED, (_m, char: string) => `${literals.push(char) - 1}`)
		.replace(/```[\s\S]*?(```|$)/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<script[\s\S]*?(<\/script>|$)/gi, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/^\s*\|?[\s:|-]*-[\s:|-]*$/gm, ' ')
		.replace(/\|/g, ' ')
		.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
		.replace(/[*_~`]+/g, '')
		.replace(/\\$/gm, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(PLACEHOLDER, (_m, i: string) => literals[Number(i)] ?? '');
	return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}
