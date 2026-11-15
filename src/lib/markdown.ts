import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { normalizeTag, tagRegExp } from './tags';
import { linkRegExp, linkTarget, normalizeTitle } from './links';
import { findTasks } from './tasks';

const marked = new Marked({ gfm: true, breaks: false });

// ==Highlighted text== (Obsidian's syntax) renders as <mark>. Underline needs no extension:
// it's written as <u>…</u>, which Markdown passes through as HTML.
marked.use({
	extensions: [
		{
			name: 'highlight',
			level: 'inline',
			start(src: string) {
				const i = src.indexOf('==');
				return i >= 0 ? i : undefined;
			},
			tokenizer(src: string) {
				const match = /^==(?!=)(?=\S)([\s\S]*?\S)==(?!=)/.exec(src);
				if (!match) return undefined;
				return { type: 'highlight', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
			},
			renderer(token) {
				return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
			}
		}
	]
});

// Mark the checkboxes Markdown task lists produce, so they can't be confused with <input>s in raw HTML.
marked.use({
	renderer: {
		checkbox({ checked }) {
			return `<input type="checkbox" data-task=""${checked ? ' checked=""' : ''} disabled=""> `;
		}
	}
});

// Links in notes open in a new tab and don't leak the app's URL.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (node.tagName === 'A' && node.getAttribute('href')) {
		node.setAttribute('target', '_blank');
		node.setAttribute('rel', 'noopener noreferrer');
	}
});

/**
 * Renders untrusted Markdown to sanitised HTML. [[Links]] and #tags become buttons
 * (data-link / data-tag) that the preview handles; with tickableTasks, task checkboxes
 * are enabled and numbered (data-task). Browser only.
 * @param knownTitles normalized titles of existing notes; links to anything else are marked "missing".
 */
export function renderMarkdown(
	source: string,
	knownTitles: ReadonlySet<string> = new Set(),
	{ tickableTasks = false } = {}
): string {
	const html = marked.parse(source, { async: false });
	const fragment = DOMPurify.sanitize(html, { ADD_ATTR: ['target'], RETURN_DOM_FRAGMENT: true });

	// Number task checkboxes so a click can be mapped back to its line. If the count doesn't match
	// what's in the source (unusual Markdown), leave them read-only rather than tick the wrong line.
	const boxes = [...fragment.querySelectorAll<HTMLInputElement>('input[data-task]')];
	if (tickableTasks && boxes.length === findTasks(source).length) {
		boxes.forEach((box, i) => {
			box.removeAttribute('disabled');
			box.dataset.task = String(i);
			// Label each box with its own item's text, leaving out any nested sub-items.
			const item = box.closest('li')?.cloneNode(true) as HTMLElement | undefined;
			item?.querySelectorAll('ul, ol').forEach((list) => list.remove());
			const label = item?.textContent?.trim().replace(/\s+/g, ' ');
			if (label) box.setAttribute('aria-label', label.slice(0, 120));
		});
	}

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
