import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const marked = new Marked({ gfm: true, breaks: false });

// Links in notes open in a new tab and don't leak the app's URL.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (node.tagName === 'A' && node.getAttribute('href')) {
		node.setAttribute('target', '_blank');
		node.setAttribute('rel', 'noopener noreferrer');
	}
});

/** Renders untrusted Markdown to sanitised HTML. Browser only. */
export function renderMarkdown(source: string): string {
	const html = marked.parse(source, { async: false });
	return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}
