import { transaction } from './db';
import { findOrCreateNotebook } from './notebooks';
import { insertImportedNote, MAX_CONTENT, MAX_TITLE } from './notes';
import { docxToMarkdown, DocxError } from './docx';

export interface ImportFile {
	/** Path relative to the import root, e.g. "Work/Ideas.md". */
	path: string;
	data: Buffer;
	modified: Date;
}

export interface ImportResult {
	imported: number;
	/** Notebooks that didn't exist before the import. */
	notebooksCreated: string[];
	/** Files that weren't imported, with the reason in brackets. */
	skipped: string[];
}

const NOTE_FILE = /\.(md|markdown|mdown|mkd|txt)$/i;
const WORD_FILE = /\.docx$/i;
const MAX_NOTEBOOK_NAME = 100;

/** True for files to ignore silently: app settings, macOS metadata, hidden files, Word lock files ("~$…"). */
export const isJunk = (path: string) =>
	path.split('/').some((part) => part.startsWith('.') || part.startsWith('~$') || part === '__MACOSX');

/** Drops a single folder that wraps everything (zipping a folder usually adds one). */
export function stripCommonRoot<T extends { path: string }>(files: T[]): T[] {
	const first = files[0]?.path.split('/')[0];
	if (!first || !files.every((f) => f.path.includes('/') && f.path.split('/')[0] === first)) return files;
	return files.map((f) => ({ ...f, path: f.path.slice(first.length + 1) }));
}

interface FrontMatter {
	title?: string;
	created?: number;
	updated?: number;
	pinned?: boolean;
}

const KNOWN_KEYS = new Set(['title', 'created', 'updated', 'pinned']);

/**
 * Reads the YAML front matter Inkwell's export writes. The block is removed from the note only when
 * it holds nothing but those keys; anything else (Obsidian aliases, tags, …) is kept in the text.
 */
function parseFrontMatter(text: string): { meta: FrontMatter; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	if (!match) return { meta: {}, body: text };

	const meta: FrontMatter = {};
	let onlyKnown = true;
	for (const line of match[1].split(/\r?\n/)) {
		if (!line.trim()) continue;
		const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
		if (!pair || !KNOWN_KEYS.has(pair[1])) {
			onlyKnown = false;
			continue;
		}
		const value = unquote(pair[2].trim());
		if (pair[1] === 'title') meta.title = value;
		else if (pair[1] === 'pinned') meta.pinned = value.toLowerCase() === 'true';
		else {
			const time = Date.parse(value);
			if (!Number.isNaN(time)) meta[pair[1] as 'created' | 'updated'] = time;
		}
	}
	return { meta, body: onlyKnown ? text.slice(match[0].length) : text };
}

function unquote(value: string): string {
	if (value.startsWith('"')) {
		try {
			return String(JSON.parse(value));
		} catch {
			return value.slice(1, value.endsWith('"') ? -1 : undefined);
		}
	}
	if (value.startsWith("'") && value.endsWith("'") && value.length > 1) return value.slice(1, -1).replaceAll("''", "'");
	return value;
}

/** Imports Markdown files as notes; each file's folder becomes its notebook. All or nothing. */
export function importNotes(userId: string, files: ImportFile[], alreadySkipped: string[] = []): ImportResult {
	const skipped = [...alreadySkipped];
	const notes: { title: string; content: string; notebook: string | null; meta: FrontMatter; modified: Date }[] = [];

	for (const file of files) {
		if (isJunk(file.path)) continue;
		const isWord = WORD_FILE.test(file.path);
		if (!isWord && !NOTE_FILE.test(file.path)) {
			skipped.push(`${file.path} (not a Markdown, text or Word file)`);
			continue;
		}

		let meta: FrontMatter = {};
		let body: string;
		if (isWord) {
			try {
				const converted = docxToMarkdown(file.data);
				body = converted.markdown;
				if (converted.title) meta = { title: converted.title };
			} catch (err) {
				if (!(err instanceof DocxError)) throw err;
				skipped.push(`${file.path} (${err.message.replace(/\.$/, '')})`);
				continue;
			}
		} else {
			const text = file.data.toString('utf8').replace(/^\uFEFF/, '');
			const parsed = parseFrontMatter(text);
			meta = parsed.meta;
			// Files end with a newline by convention (Inkwell's export adds one); notes don't need it.
			body = parsed.body.replace(/\r?\n$/, '');
		}
		if (body.length > MAX_CONTENT) {
			skipped.push(`${file.path} (too long)`);
			continue;
		}
		const parts = file.path.split('/');
		const fileName = parts.pop()!.replace(isWord ? WORD_FILE : NOTE_FILE, '');
		const folders = parts.filter(Boolean).join(' / ');
		notes.push({
			title: (meta.title ?? fileName).slice(0, MAX_TITLE),
			content: body,
			notebook: folders ? folders.slice(0, MAX_NOTEBOOK_NAME).trim() : null,
			meta,
			modified: file.modified
		});
	}

	const notebooksCreated: string[] = [];
	transaction(() => {
		const notebookIds = new Map<string, string>();
		for (const note of notes) {
			let notebookId: string | null = null;
			if (note.notebook) {
				const key = note.notebook.toLowerCase();
				if (!notebookIds.has(key)) {
					const { id, created } = findOrCreateNotebook(userId, note.notebook);
					notebookIds.set(key, id);
					if (created) notebooksCreated.push(note.notebook);
				}
				notebookId = notebookIds.get(key)!;
			}
			const fallback = Number.isNaN(note.modified.getTime()) ? Date.now() : note.modified.getTime();
			const updatedAt = note.meta.updated ?? fallback;
			insertImportedNote(userId, {
				title: note.title,
				content: note.content,
				notebookId,
				pinned: note.meta.pinned ?? false,
				createdAt: note.meta.created ?? updatedAt,
				updatedAt
			});
		}
	});

	return { imported: notes.length, notebooksCreated, skipped };
}
