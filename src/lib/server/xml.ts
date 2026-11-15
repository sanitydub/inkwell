// A small XML reader for Word documents: elements, attributes, text and CDATA, with entities
// decoded. Comments, processing instructions and doctypes are skipped. It assumes well-formed
// input (which Office files are) and doesn't resolve namespaces: names keep their prefix, as in "w:p".

export interface XmlElement {
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
}

export type XmlNode = XmlElement | string;

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
		if (entity[0] !== '#') return NAMED[entity] ?? whole;
		const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
		return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
	});
}

function parseAttrs(source: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const m of source.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]] = decode(m[2] ?? m[3]);
	return attrs;
}

const TOKEN =
	/<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;

/** Parses XML into a tree under a "#document" root. */
export function parseXml(xml: string): XmlElement {
	const root: XmlElement = { name: '#document', attrs: {}, children: [] };
	const stack: XmlElement[] = [root];
	for (const m of xml.matchAll(TOKEN)) {
		const top = stack[stack.length - 1];
		if (m[1] !== undefined) top.children.push(m[1]);
		else if (m[2] !== undefined) {
			if (stack.length > 1) stack.pop();
		} else if (m[3] !== undefined) {
			const element: XmlElement = { name: m[3], attrs: parseAttrs(m[4] ?? ''), children: [] };
			top.children.push(element);
			if (!m[5]) stack.push(element);
		} else if (m[6] !== undefined) top.children.push(decode(m[6]));
	}
	return root;
}

// ---- Helpers ------------------------------------------------------------------------------

export const isElement = (node: XmlNode | undefined): node is XmlElement => typeof node === 'object';

/** Direct child elements, optionally only those with a given name. */
export const elements = (el: XmlElement, name?: string): XmlElement[] =>
	el.children.filter((c): c is XmlElement => isElement(c) && (!name || c.name === name));

/** The first direct child element with this name. */
export const child = (el: XmlElement | undefined, name: string): XmlElement | undefined =>
	el ? elements(el, name)[0] : undefined;

/** The first element with this name anywhere below `el`. */
export function find(el: XmlElement, name: string): XmlElement | undefined {
	for (const c of elements(el)) {
		if (c.name === name) return c;
		const deeper = find(c, name);
		if (deeper) return deeper;
	}
	return undefined;
}

/** All text inside an element. */
export const textOf = (el: XmlElement): string =>
	el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
