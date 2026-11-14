import { error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { snippetFrom } from '#lib/snippet.ts';
import type { Note, NoteSummary, View } from '#lib/types.ts';

const MAX_TITLE = 500;
const MAX_CONTENT = 5_000_000;

interface NoteRow {
	id: string;
	title: string;
	content: string;
	pinned: number;
	trashed_at: number | null;
	created_at: number;
	updated_at: number;
}

const toNote = (r: NoteRow): Note => ({
	id: r.id,
	title: r.title,
	content: r.content,
	pinned: r.pinned === 1,
	trashed: r.trashed_at !== null,
	createdAt: r.created_at,
	updatedAt: r.updated_at
});

const toSummary = (r: NoteRow): NoteSummary => ({
	id: r.id,
	title: r.title,
	snippet: snippetFrom(r.content),
	pinned: r.pinned === 1,
	trashed: r.trashed_at !== null,
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
	'n.id, n.title, substr(n.content, 1, 1200) AS content, n.pinned, n.trashed_at, n.created_at, n.updated_at';

export function listNotes(userId: string, view: View, q = ''): NoteSummary[] {
	const db = getDb();
	const { where, order } = VIEWS[view];
	const match = ftsQuery(q);
	const rows = match
		? db
				.prepare(
					`SELECT ${LIST_COLS} FROM notes_fts JOIN notes n ON n.seq = notes_fts.rowid
					 WHERE notes_fts MATCH ? AND n.user_id = ? AND ${where}
					 ORDER BY bm25(notes_fts, 4.0, 1.0) LIMIT 200`
				)
				.all(match, userId)
		: db
				.prepare(`SELECT ${LIST_COLS} FROM notes n WHERE n.user_id = ? AND ${where} ORDER BY ${order}`)
				.all(userId);
	return (rows as unknown as NoteRow[]).map(toSummary);
}

export function getNote(userId: string, id: string): Note | null {
	const row = getDb().prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, userId);
	return row ? toNote(row as unknown as NoteRow) : null;
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

export function createNote(userId: string, body: Record<string, unknown>): Note {
	const title = body.title === undefined ? '' : text(body.title, 'title', MAX_TITLE);
	const content = body.content === undefined ? '' : text(body.content, 'content', MAX_CONTENT);
	const now = Date.now();
	const note: Note = { id: randomUUID(), title, content, pinned: false, trashed: false, createdAt: now, updatedAt: now };
	getDb()
		.prepare('INSERT INTO notes (id, user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
		.run(note.id, userId, title, content, now, now);
	return note;
}

export function updateNote(userId: string, id: string, body: Record<string, unknown>): Note | null {
	const sets: string[] = [];
	const params: (string | number)[] = [];

	if ('title' in body) {
		sets.push('title = ?');
		params.push(text(body.title, 'title', MAX_TITLE));
	}
	if ('content' in body) {
		sets.push('content = ?');
		params.push(text(body.content, 'content', MAX_CONTENT));
	}
	// Only real edits move a note's "last edited" time; pinning and trashing don't.
	if (sets.length) {
		sets.push('updated_at = ?');
		params.push(Date.now());
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
	if (!sets.length) error(400, 'Send at least one of: title, content, pinned, trashed.');

	const row = getDb()
		.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`)
		.get(...params, id, userId);
	return row ? toNote(row as unknown as NoteRow) : null;
}

export function deleteNote(userId: string, id: string): boolean {
	const res = getDb().prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, userId);
	return Number(res.changes) > 0;
}

export function emptyTrash(userId: string): number {
	const res = getDb().prepare('DELETE FROM notes WHERE user_id = ? AND trashed_at IS NOT NULL').run(userId);
	return Number(res.changes);
}
