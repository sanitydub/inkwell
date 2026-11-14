/** Plain-text preview of a Markdown note for the note list. */
export function snippetFrom(markdown: string, max = 140): string {
	const text = markdown
		.slice(0, 1200)
		.replace(/```[\s\S]*?(```|$)/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<script[\s\S]*?(<\/script>|$)/gi, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/^\s*\|?[\s:|-]*-[\s:|-]*$/gm, ' ')
		.replace(/\|/g, ' ')
		.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
		.replace(/[*_~`]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}
