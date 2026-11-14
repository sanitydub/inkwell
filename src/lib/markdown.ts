import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { normalizeTag, tagRegExp } from './tags';

const marked = new Marked({ gfm: true, breaks: false });

// Links in notes open in a new tab and don't leak the app's URL.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (node.tagName === 'A' && node.getAttribute('href')) {
		node.setAttribute('target', '_blank');
		node.setAttribute('rel', 'noopener noreferrer');
	}
});

/** Renders untrusted Markdown to sanitised HTML, with #tags turned into buttons. Browser only. */
export function renderMarkdown(source: string): string {
	const html = marked.parse(source, { async: false });
	const fragment = DOMPurify.sanitize(html, { ADD_ATTR: ['target'], RETURN_DOM_FRAGMENT: true });
	linkTags(fragment);
	const container = document.createElement('div');
	container.append(fragment);
	return container.innerHTML;
}

/** Wraps #tags in text (outside code and links) in <button class="tag" data-tag="…">. */
function linkTags(root: DocumentFragment) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node as Text;
		if (text.data.includes('#') && !text.parentElement?.closest('code, pre, a, button')) textNodes.push(text);
	}
	for (const text of textNodes) {
		const parts: (string | Node)[] = [];
		let last = 0;
		for (const match of text.data.matchAll(tagRegExp())) {
			const tag = normalizeTag(match[1]);
			if (!tag) continue;
			const start = match.index!;
			parts.push(text.data.slice(last, start));
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'tag';
			button.dataset.tag = tag;
			button.textContent = match[0];
			parts.push(button);
			last = start + match[0].length;
		}
		if (last === 0) continue;
		parts.push(text.data.slice(last));
		text.replaceWith(...parts);
	}
}
