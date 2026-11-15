import { error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { getDb, transaction } from './db';
import { notebookExists } from './notebooks';
import { getVersion, prepareRestore, snapshotBeforeSave } from './versions';
import { snippetFrom } from '#lib/snippet.ts';
import { extractTags } from '#lib/tags.ts';
import { extractLinks, isLinkableTitle, linkRegExp, linkTarget, normalizeTitle, retargetLinks } from '#lib/links.ts';
import type { Backlink, Note, NoteSummary, NoteTitle, TagCount, View } from '#lib/types.ts';

export const MAX_TITLE = 500;
export const MAX_CONTENT = 5_000_000;

interface NoteRow {
	id: string;
	title: string;
	content: string;
	pinned: number;
	trashed_at: number | null;
	notebook_id: string | null;
	created_at: number;
	updated_at: number;
}

const toNote = (r: NoteRow, tags: string[]): Note => ({
	id: r.id,
	title: r.title,
	content: r.content,
	pinned: r.pinned === 1,
	trashed: r.trashed_at !== null,
	notebookId: r.notebook_id,
	tags,
	createdAt: r.created_at,
	updatedAt: r.updated_at
});

const toSummary = (r: NoteRow): NoteSummary => ({
	id: r.id,
	title: r.title,
	snippet: snippetFrom(r.content),
	pinned: r.pinned === 1,
	trashed: r.trashed_at !== null,
	notebookId: r.notebook_id,
	updatedAt: r.updated_at
});

const VIEWS: Record<View, { where: string; order: string }> = {
	all: { where: 'n.trashed_at IS NULL', order: 'n.pinned DESC, n.updated_at DESC' },
	pinned: { where: 'n.trashed_at IS NULL AND n.pinned = 1', order: 'n.updated_at DESC' },
	trash: { where: 'n.trashed_at IS NOT NULL', order: 'n.trashed_at DESC' }
};

export const isView = (v: unknown): v is View => typeof v === 'string' && v in VIEWS;

/** Turns free text into a safe FTS5 query: every word is a quoted prefix match. */
function ftsQuery(q: string): string | null {
	const terms = q.split(/\s+/).filter(Boolean).slice(0, 12);
	if (!terms.length) return null;
	return terms.map((t) => `"${t.replaceAll('"', '""')}"*`).join(' ');
}

// The list only needs the start of each note for its snippet.
const LIST_COLS =
	'n.id, n.title, substr(n.content, 1, 1200) AS content, n.pinned, n.trashed_at, n.notebook_id, n.created_at, n.updated_at';

export interface NoteFilter {
	view: View;
	q?: string;
	notebookId?: string | null;
	/** Matches the tag and anything nested under it: "project" also finds "project/inkwell". */
	tag?: string | null;
}

export function listNotes(userId: string, filter: NoteFilter): NoteSummary[] {
	const where = ['n.user_id = ?', VIEWS[filter.view].where];
	const params: string[] = [userId];
	if (filter.notebookId) {
		where.push('n.notebook_id = ?');
		params.push(filter.notebookId);
	}
	if (filter.tag) {
		where.push(
			`EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id
			 AND (t.tag = ? OR substr(t.tag, 1, length(?) + 1) = ? || '/'))`
		);
		params.push(filter.tag, filter.tag, filter.tag);
	}

	const match = ftsQuery(filter.q ?? '');
	const rows = match
		? getDb()
				.prepare(
					`SELECT ${LIST_COLS} FROM notes_fts JOIN notes n ON n.seq = notes_fts.rowid
					 WHERE notes_fts MATCH ? AND ${where.join(' AND ')}
					 ORDER BY bm25(notes_fts, 4.0, 1.0) LIMIT 200`
				)
				.all(match, ...params)
		: getDb()
				.prepare(`SELECT ${LIST_COLS} FROM notes n WHERE ${where.join(' AND ')} ORDER BY ${VIEWS[filter.view].order}`)
				.all(...params);
	return (rows as unknown as NoteRow[]).map(toSummary);
}

function tagsOf(noteId: string): string[] {
	const rows = getDb().prepare('SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag').all(noteId);
	return (rows as unknown as { tag: string }[]).map((r) => r.tag);
}

/** Rebuilds a note's tag and link index from its content. Call inside a transaction. */
function indexContent(noteId: string, content: string) {
	const db = getDb();
	db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
	const insertTag = db.prepare('INSERT INTO note_tags (note_id, tag) VALUES (?, ?)');
	for (const tag of extractTags(content)) insertTag.run(noteId, tag);

	db.prepare('DELETE FROM note_links WHERE note_id = ?').run(noteId);
	const insertLink = db.prepare('INSERT INTO note_links (note_id, target) VALUES (?, ?)');
	for (const target of extractLinks(content)) insertLink.run(noteId, target);
}

/** Titles of all notes outside the trash, most recently edited first (the order links resolve in). */
export function listTitles(userId: string): NoteTitle[] {
	return getDb()
		.prepare('SELECT id, title FROM notes WHERE user_id = ? AND trashed_at IS NULL ORDER BY updated_at DESC')
		.all(userId) as unknown as NoteTitle[];
}

/** Notes outside the trash that [[link]] to this note's title. Null if the note doesn't exist. */
export function listBacklinks(userId: string, id: string): Backlink[] | null {
	const note = getDb().prepare('SELECT title FROM notes WHERE id = ? AND user_id = ?').get(id, userId) as
		| { title: string }
		| undefined;
	if (!note) return null;
	const target = normalizeTitle(note.title);
	if (!target) return [];

	const rows = getDb()
		.prepare(
			`SELECT n.id, n.title, n.content FROM note_links l JOIN notes n ON n.id = l.note_id
			 WHERE l.target = ? AND n.user_id = ? AND n.trashed_at IS NULL AND n.id != ?
			 ORDER BY n.updated_at DESC`
		)
		.all(target, userId, id) as unknown as { id: string; title: string; content: string }[];

	return rows.map((r) => {
		const line = r.content
			.split('\n')
			.find((l) => [...l.matchAll(linkRegExp())].some((m) => normalizeTitle(linkTarget(m[1])) === target));
		// Same plain-text cleanup as list snippets: no Markdown syntax, links shown as their text.
		return { id: r.id, title: r.title, context: snippetFrom(line ?? '', 160) };
	});
}

/** Tags in use across the user's notes outside the trash. */
export function listTags(userId: string): TagCount[] {
	const rows = getDb()
		.prepare(
			`SELECT t.tag AS name, COUNT(*) AS note_count FROM note_tags t JOIN notes n ON n.id = t.note_id
			 WHERE n.user_id = ? AND n.trashed_at IS NULL GROUP BY t.tag ORDER BY t.tag`
		)
		.all(userId);
	return (rows as unknown as { name: string; note_count: number }[]).map((r) => ({
		name: r.name,
		noteCount: Number(r.note_count)
	}));
}

export function getNote(userId: string, id: string): Note | null {
	const row = getDb().prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, userId);
	return row ? toNote(row as unknown as NoteRow, tagsOf(id)) : null;
}

function text(value: unknown, field: string, max: number): string {
	if (typeof value !== 'string') error(400, `"${field}" must be text.`);
	if (value.length > max) error(413, `"${field}" is too long (limit ${max.toLocaleString('en')} characters).`);
	return value;
}

function bool(value: unknown, field: string): boolean {
	if (typeof value !== 'boolean') error(400, `"${field}" must be true or false.`);
	return value;
}

function notebookRef(userId: string, value: unknown): string | null {
	if (value === null) return null;
	if (typeof value !== 'string' || !notebookExists(userId, value)) {
		error(400, '"notebookId" must be one of your notebooks, or null.');
	}
	return value;
}

export function createNote(userId: string, body: Record<string, unknown>): Note {
	const title = body.title === undefined ? '' : text(body.title, 'title', MAX_TITLE);
	const content = body.content === undefined ? '' : text(body.content, 'content', MAX_CONTENT);
	const notebookId = body.notebookId === undefined ? null : notebookRef(userId, body.notebookId);
	const now = Date.now();
	const note: Note = {
		id: randomUUID(),
		title,
		content,
		pinned: false,
		trashed: false,
		notebookId,
		tags: extractTags(content),
		createdAt: now,
		updatedAt: now
	};
	transaction(() => {
		getDb()
			.prepare(
				'INSERT INTO notes (id, user_id, title, content, notebook_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
			)
			.run(note.id, userId, title, content, notebookId, now, now);
		indexContent(note.id, content);
	});
	return note;
}

/** Inserts a note from an import, keeping its own dates. Call inside a transaction. */
export function insertImportedNote(
	userId: string,
	note: { title: string; content: string; notebookId: string | null; pinned: boolean; createdAt: number; updatedAt: number }
) {
	const id = randomUUID();
	getDb()
		.prepare(
			`INSERT INTO notes (id, user_id, title, content, notebook_id, pinned, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(id, userId, note.title, note.content, note.notebookId, note.pinned ? 1 : 0, note.createdAt, note.updatedAt);
	indexContent(id, note.content);
	return id;
}

export function updateNote(userId: string, id: string, body: Record<string, unknown>): Note | null {
	const sets: string[] = [];
	const params: (string | number | null)[] = [];

	if ('title' in body) {
		sets.push('title = ?');
		params.push(text(body.title, 'title', MAX_TITLE));
	}
	if ('content' in body) {
		sets.push('content = ?');
		params.push(text(body.content, 'content', MAX_CONTENT));
	}
	// Only real edits move a note's "last edited" time; filing, pinning and trashing don't.
	if (sets.length) {
		sets.push('updated_at = ?');
		params.push(Date.now());
	}
	if ('notebookId' in body) {
		sets.push('notebook_id = ?');
		params.push(notebookRef(userId, body.notebookId));
	}
	if ('pinned' in body) {
		sets.push('pinned = ?');
		params.push(bool(body.pinned, 'pinned') ? 1 : 0);
	}
	if ('trashed' in body) {
		if (bool(body.trashed, 'trashed')) {
			sets.push('trashed_at = COALESCE(trashed_at, ?)');
			params.push(Date.now());
		} else {
			sets.push('trashed_at = NULL');
		}
	}
	if (!sets.length) error(400, 'Send at least one of: title, content, notebookId, pinned, trashed.');

	return transaction(() => {
		if ('title' in body || 'content' in body) {
			const owned = getDb().prepare('SELECT 1 FROM notes WHERE id = ? AND user_id = ?').get(id, userId);
			if (owned) snapshotBeforeSave(id, { title: body.title as string | undefined, content: body.content as string | undefined });
		}
		const row = getDb()
			.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`)
			.get(...params, id, userId) as unknown as NoteRow | undefined;
		if (!row) return null;
		if ('content' in body) indexContent(id, row.content);
		return toNote(row, tagsOf(id));
	});
}

/** Puts an earlier version's title and text back. The note as it was is kept as a version first. */
export function restoreNoteVersion(userId: string, id: string, versionId: string): Note | null {
	return transaction(() => {
		const version = getVersion(userId, id, versionId);
		if (!version) return null;
		prepareRestore(id, version);
		const row = getDb()
			.prepare('UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ? RETURNING *')
			.get(version.title, version.content, Date.now(), id, userId) as unknown as NoteRow | undefined;
		if (!row) return null;
		indexContent(id, row.content);
		return toNote(row, tagsOf(id));
	});
}

export function deleteNote(userId: string, id: string): boolean {
	const res = getDb().prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, userId);
	return Number(res.changes) > 0;
}

export function emptyTrash(userId: string): number {
	const res = getDb().prepare('DELETE FROM notes WHERE user_id = ? AND trashed_at IS NOT NULL').run(userId);
	return Number(res.changes);
}

/**
 * Notes (outside the trash, other than this one) whose [[links]] point at `from` and would move to
 * this note's current title. Empty when the links should stay: the title didn't really change,
 * the new title can't be linked to, or another note still has the old title. Null if no such note.
 */
export function relinkCandidates(userId: string, id: string, from: string): NoteTitle[] | null {
	const note = getDb().prepare('SELECT title FROM notes WHERE id = ? AND user_id = ?').get(id, userId) as
		| { title: string }
		| undefined;
	if (!note) return null;
	const old = normalizeTitle(from);
	if (!old || old === normalizeTitle(note.title) || !isLinkableTitle(note.title)) return [];

	const stillTaken = listTitles(userId).some((t) => t.id !== id && normalizeTitle(t.title) === old);
	if (stillTaken) return [];

	return getDb()
		.prepare(
			`SELECT n.id, n.title FROM note_links l JOIN notes n ON n.id = l.note_id
			 WHERE l.target = ? AND n.user_id = ? AND n.trashed_at IS NULL AND n.id != ?
			 ORDER BY n.updated_at DESC`
		)
		.all(old, userId, id) as unknown as NoteTitle[];
}

/** Rewrites the links found by relinkCandidates to the note's current title. Returns the notes changed. */
export function relinkNotes(userId: string, id: string, from: string): NoteTitle[] | null {
	const candidates = relinkCandidates(userId, id, from);
	if (!candidates?.length) return candidates;
	const to = (getDb().prepare('SELECT title FROM notes WHERE id = ?').get(id) as { title: string }).title.trim();
	const old = normalizeTitle(from);
	const now = Date.now();
	const changed: NoteTitle[] = [];
	transaction(() => {
		for (const candidate of candidates) {
			const { content } = getDb().prepare('SELECT content FROM notes WHERE id = ?').get(candidate.id) as { content: string };
			const next = retargetLinks(content, old, to);
			if (next === content) continue;
			getDb().prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(next, now, candidate.id);
			indexContent(candidate.id, next);
			changed.push(candidate);
		}
	});
	return changed;
}
