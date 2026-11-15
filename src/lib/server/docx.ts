import { readZip } from './unzip';
import { child, elements, find, parseXml, textOf, type XmlElement } from './xml';

// Word (.docx) → Markdown, for imports. Covers what notes need: headings, the document title,
// bold/italic/strikethrough, links, bulleted and numbered lists (including nested ones and lists
// that come from styles like "List Bullet"), quotes and tables. Images, comments and footnotes
// are left out. Tracked deletions are dropped and tracked insertions kept.

export class DocxError extends Error {}

interface StyleInfo {
	name: string;
	numId?: string;
	ilvl?: number;
}

interface Context {
	rels: Map<string, string>;
	/** numId → level → number format ("bullet", "decimal", …) */
	numbering: Map<string, Map<number, string>>;
	styles: Map<string, StyleInfo>;
}

interface Segment {
	text: string;
	bold: boolean;
	italic: boolean;
	strike: boolean;
	underline: boolean;
	/** Inkwell highlight colour, or null for none. */
	highlight: string | null;
	href?: string;
}

/** Word's highlight colours, mapped onto Inkwell's five. Anything else becomes yellow. */
const WORD_HIGHLIGHTS: Record<string, string> = {
	green: 'green',
	darkgreen: 'green',
	cyan: 'blue',
	blue: 'blue',
	darkblue: 'blue',
	darkcyan: 'blue',
	magenta: 'pink',
	red: 'pink',
	darkred: 'pink',
	darkmagenta: 'purple'
};

function highlightOf(el?: XmlElement): string | null {
	if (!isOn(el)) return null;
	return WORD_HIGHLIGHTS[(el!.attrs['w:val'] ?? '').toLowerCase()] ?? 'yellow';
}

const isOn = (el?: XmlElement) => !!el && !['0', 'false', 'off', 'none'].includes((el.attrs['w:val'] ?? '').toLowerCase());

// ---- Reading the package ----------------------------------------------------------------

function readContext(file: (path: string) => string | undefined): Context {
	const rels = new Map<string, string>();
	const relsXml = file('word/_rels/document.xml.rels');
	if (relsXml) {
		for (const rel of elements(parseXml(relsXml).children.find((c) => typeof c === 'object') as XmlElement)) {
			if (rel.attrs.Id && rel.attrs.Target) rels.set(rel.attrs.Id, rel.attrs.Target);
		}
	}

	const numbering = new Map<string, Map<number, string>>();
	const numberingXml = file('word/numbering.xml');
	if (numberingXml) {
		const root = find(parseXml(numberingXml), 'w:numbering');
		if (root) {
			const abstract = new Map<string, Map<number, string>>();
			for (const a of elements(root, 'w:abstractNum')) {
				const levels = new Map<number, string>();
				for (const lvl of elements(a, 'w:lvl')) {
					levels.set(Number(lvl.attrs['w:ilvl'] ?? 0), child(lvl, 'w:numFmt')?.attrs['w:val'] ?? 'bullet');
				}
				abstract.set(a.attrs['w:abstractNumId'], levels);
			}
			for (const n of elements(root, 'w:num')) {
				const levels = abstract.get(child(n, 'w:abstractNumId')?.attrs['w:val'] ?? '');
				if (levels) numbering.set(n.attrs['w:numId'], levels);
			}
		}
	}

	const styles = new Map<string, StyleInfo>();
	const stylesXml = file('word/styles.xml');
	if (stylesXml) {
		const root = find(parseXml(stylesXml), 'w:styles');
		for (const s of root ? elements(root, 'w:style') : []) {
			const numPr = child(child(s, 'w:pPr'), 'w:numPr');
			styles.set(s.attrs['w:styleId'], {
				name: (child(s, 'w:name')?.attrs['w:val'] ?? s.attrs['w:styleId'] ?? '').toLowerCase(),
				numId: child(numPr, 'w:numId')?.attrs['w:val'],
				ilvl: child(numPr, 'w:ilvl') ? Number(child(numPr, 'w:ilvl')!.attrs['w:val']) : undefined
			});
		}
	}
	return { rels, numbering, styles };
}

// ---- Inline text ----------------------------------------------------------------------------

const PASS_THROUGH = new Set(['w:ins', 'w:smartTag', 'w:customXml', 'w:sdt', 'w:sdtContent', 'w:fldSimple', 'w:bdo', 'w:dir']);

function collect(el: XmlElement, ctx: Context, out: Segment[], href?: string) {
	for (const c of elements(el)) {
		if (c.name === 'w:r') {
			const rPr = child(c, 'w:rPr');
			let text = '';
			for (const r of elements(c)) {
				if (r.name === 'w:t') text += textOf(r);
				else if (r.name === 'w:tab') text += ' ';
				else if (r.name === 'w:br' || r.name === 'w:cr') text += '\n';
				else if (r.name === 'w:noBreakHyphen') text += '-';
			}
			if (text) {
				out.push({
					text,
					bold: isOn(child(rPr, 'w:b')),
					italic: isOn(child(rPr, 'w:i')),
					strike: isOn(child(rPr, 'w:strike')) || isOn(child(rPr, 'w:dstrike')),
					underline: isOn(child(rPr, 'w:u')),
					highlight: highlightOf(child(rPr, 'w:highlight')),
					href
				});
			}
		} else if (c.name === 'w:hyperlink') {
			const target = c.attrs['r:id'] ? ctx.rels.get(c.attrs['r:id']) : undefined;
			collect(c, ctx, out, target && /^(https?|mailto):/i.test(target) ? target : href);
		} else if (PASS_THROUGH.has(c.name)) {
			collect(c, ctx, out, href);
		}
		// Everything else (w:pPr, w:del for tracked deletions, bookmarks, comments) is skipped.
	}
}

/** Escapes characters that would otherwise turn into Markdown formatting (including "==" highlights). */
const escapeInline = (text: string) => text.replace(/([\\`*_<~])/g, '\\$1').replace(/=(?==)/g, '\\=');

function render(segments: Segment[]): string {
	const merged: Segment[] = [];
	for (const s of segments) {
		const last = merged.at(-1);
		const same = (k: 'bold' | 'italic' | 'strike' | 'underline' | 'highlight') => last?.[k] === s[k];
		if (last && same('bold') && same('italic') && same('strike') && same('underline') && same('highlight') && last.href === s.href) {
			last.text += s.text;
		} else merged.push({ ...s });
	}
	return merged
		.map((s) => {
			const text = escapeInline(s.text);
			const inner = text.trim();
			if (!inner) return text;
			const lead = text.slice(0, text.indexOf(inner));
			const trail = text.slice(text.indexOf(inner) + inner.length);
			let out = inner;
			if (s.underline && !s.href) out = `<u>${out}</u>`;
			if (s.highlight === 'yellow') out = `==${out}==`;
			else if (s.highlight) out = `<mark class="hl-${s.highlight}">${out}</mark>`;
			if (s.strike) out = `~~${out}~~`;
			if (s.italic) out = `*${out}*`;
			if (s.bold) out = `**${out}**`;
			if (s.href) out = `[${out}](${s.href.replace(/[ ()]/g, encodeURIComponent)})`;
			return lead + out + trail;
		})
		.join('');
}

/** Stops a paragraph's first characters from being read as a heading, quote or list marker. */
function escapeLineStart(line: string): string {
	if (/^(#{1,6}(\s|$)|>|[-+](\s|$))/.test(line)) return '\\' + line;
	return line.replace(/^(\d+)([.)])(\s|$)/, '$1\\$2$3');
}

// ---- Blocks ---------------------------------------------------------------------------------

interface Block {
	text: string;
	/** Items of the same list join with a single newline; everything else is separated by a blank line. */
	list?: string;
}

function paragraphBlock(p: XmlElement, ctx: Context, listIndents: string[]): Block | { title: string } | null {
	const pPr = child(p, 'w:pPr');
	const styleId = child(pPr, 'w:pStyle')?.attrs['w:val'] ?? '';
	const style = ctx.styles.get(styleId);
	const styleName = style?.name ?? styleId.toLowerCase();

	const segments: Segment[] = [];
	collect(p, ctx, segments);
	const text = render(segments).replace(/^\s+|\s+$/g, '');
	if (!text) return null;

	// Lists: direct numbering, or numbering that comes from the paragraph style.
	const numPr = child(pPr, 'w:numPr');
	const numId = child(numPr, 'w:numId')?.attrs['w:val'] ?? style?.numId;
	const level = Number(child(numPr, 'w:ilvl')?.attrs['w:val'] ?? style?.ilvl ?? 0);
	let format = numId && numId !== '0' ? (ctx.numbering.get(numId)?.get(level) ?? 'bullet') : undefined;
	if (!format && /^list (bullet|number)/.test(styleName)) format = styleName.includes('number') ? 'decimal' : 'bullet';

	if (format && format !== 'none') {
		const marker = format === 'bullet' ? '- ' : '1. ';
		listIndents.length = level + 1;
		for (let l = 0; l <= level; l++) listIndents[l] ??= l === 0 ? '' : listIndents[l - 1] + '  ';
		const indent = listIndents[level];
		// Nested items line up under their parent's text.
		listIndents[level + 1] = indent + ' '.repeat(marker.length);
		const body = text.split('\n').join(`\\\n${indent}${' '.repeat(marker.length)}`);
		return { text: indent + marker + body, list: numId && numId !== '0' ? `num:${numId}` : `style:${styleName}` };
	}
	listIndents.length = 0;

	const lines = text.split('\n');
	const joined = [escapeLineStart(lines[0]), ...lines.slice(1)].join('\\\n');
	if (styleName === 'title') return { title: textOf(p).trim() };
	const heading = /^heading (\d)/.exec(styleName);
	if (heading) return { text: `${'#'.repeat(Math.min(Number(heading[1]), 6))} ${lines.join(' ')}`, };
	if (/quote/.test(styleName)) return { text: `> ${lines.join('\\\n> ')}`, };
	return { text: joined, };
}

function tableBlock(tbl: XmlElement, ctx: Context): Block | null {
	const rows = elements(tbl, 'w:tr').map((tr) =>
		elements(tr, 'w:tc').map((tc) =>
			elements(tc, 'w:p')
				.map((p) => {
					const segments: Segment[] = [];
					collect(p, ctx, segments);
					return render(segments).trim().replace(/\n/g, ' ');
				})
				.filter(Boolean)
				.join('<br>')
				.replace(/\|/g, '\\|')
		)
	);
	if (!rows.length) return null;
	const width = Math.max(...rows.map((r) => r.length));
	const line = (cells: string[]) => `| ${[...cells, ...Array(width - cells.length).fill('')].join(' | ')} |`;
	return { text: [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n'), };
}

// ---- Entry point ----------------------------------------------------------------------------

/** Converts a .docx file to Markdown. The title comes from the document properties or a Title paragraph. */
export function docxToMarkdown(data: Buffer): { title: string | null; markdown: string } {
	let files;
	try {
		files = readZip(data, { maxFiles: 5_000, maxTotalBytes: 100 * 1024 * 1024 }).files;
	} catch {
		throw new DocxError('This Word document is damaged or isn’t a .docx file.');
	}
	const file = (path: string) => files.find((f) => f.path === path)?.data.toString('utf8');
	const documentXml = file('word/document.xml');
	if (!documentXml) throw new DocxError('This isn’t a Word (.docx) document.');

	const ctx = readContext(file);
	const body = find(parseXml(documentXml), 'w:body');
	if (!body) throw new DocxError('This Word document has no content.');

	const coreXml = file('docProps/core.xml');
	const titleElement = coreXml ? find(parseXml(coreXml), 'dc:title') : undefined;
	let title = titleElement ? textOf(titleElement).trim() : '';

	const blocks: Block[] = [];
	const listIndents: string[] = [];
	const visit = (container: XmlElement) => {
		for (const el of elements(container)) {
			if (el.name === 'w:p') {
				const block = paragraphBlock(el, ctx, listIndents);
				if (!block) continue;
				if ('title' in block) {
					// The first Title paragraph names the note; later ones become headings.
					if (!title && !blocks.length) title = block.title;
					else blocks.push({ text: `# ${block.title}`, });
				} else blocks.push(block);
			} else if (el.name === 'w:tbl') {
				listIndents.length = 0;
				const block = tableBlock(el, ctx);
				if (block) blocks.push(block);
			} else if (el.name === 'w:sdt' || el.name === 'w:sdtContent' || el.name === 'w:customXml') {
				visit(el);
			}
		}
	};
	visit(body);

	const markdown = blocks
		.map((b, i) => (i === 0 ? '' : b.list && b.list === blocks[i - 1].list ? '\n' : '\n\n') + b.text)
		.join('');
	return { title: title || null, markdown };
}
