import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { normalizeTag, tagRegExp } from './tags';
import { linkRegExp, linkTarget, normalizeTitle } from './links';

const marked = new Marked({ gfm: true, breaks: false });

// Links in notes open in a new tab and don't leak the app's URL.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (node.tagName === 'A' && node.getAttribute('href')) {
		node.setAttribute('target', '_blank');
		node.setAttribute('rel', 'noopener noreferrer');
	}
});

/**
 * Renders untrusted Markdown to sanitised HTML. [[Links]] and #tags become buttons
 * (data-link / data-tag) that the preview handles. Browser only.
 * @param knownTitles normalized titles of existing notes; links to anything else are marked "missing".
 */
export function renderMarkdown(source: string, knownTitles: ReadonlySet<string> = new Set()): string {
	const html = marked.parse(source, { async: false });
	const fragment = DOMPurify.sanitize(html, { ADD_ATTR: ['target'], RETURN_DOM_FRAGMENT: true });

	replaceInText(fragment, linkRegExp, (match) => {
		const target = linkTarget(match[1]);
		if (!target) return null;
		const button = document.createElement('button');
		button.type = 'button';
		const exists = knownTitles.has(normalizeTitle(target));
		button.className = exists ? 'wikilink' : 'wikilink missing';
		if (!exists) button.title = `No note called “${target}” yet. Click to create it.`;
		button.dataset.link = target;
		button.textContent = (match[2] ?? match[1]).trim();
		return button;
	});
	replaceInText(fragment, tagRegExp, (match) => {
		const tag = normalizeTag(match[1]);
		if (!tag) return null;
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'tag';
		button.dataset.tag = tag;
		button.textContent = match[0];
		return button;
	});

	const container = document.createElement('div');
	container.append(fragment);
	return container.innerHTML;
}

/** Replaces regex matches in text nodes (outside code, links and buttons) with the node `make` returns. */
function replaceInText(root: DocumentFragment, regex: () => RegExp, make: (match: RegExpMatchArray) => Node | null) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (!(node as Text).parentElement?.closest('code, pre, a, button')) textNodes.push(node as Text);
	}
	for (const text of textNodes) {
		const parts: (string | Node)[] = [];
		let last = 0;
		for (const match of text.data.matchAll(regex())) {
			const node = make(match);
			if (!node) continue;
			parts.push(text.data.slice(last, match.index), node);
			last = match.index! + match[0].length;
		}
		if (last === 0) continue;
		parts.push(text.data.slice(last));
		text.replaceWith(...parts);
	}
}
