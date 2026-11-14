import { error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import type { Notebook } from '#lib/types.ts';

const MAX_NAME = 100;

interface NotebookRow {
	id: string;
	name: string;
	created_at: number;
	note_count: number;
}

const toNotebook = (r: NotebookRow): Notebook => ({
	id: r.id,
	name: r.name,
	noteCount: Number(r.note_count),
	createdAt: r.created_at
});

const COUNT = '(SELECT COUNT(*) FROM notes n WHERE n.notebook_id = b.id AND n.trashed_at IS NULL) AS note_count';

function parseName(value: unknown): string {
	const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
	if (!name) error(400, 'Give the notebook a name.');
	if (name.length > MAX_NAME) error(400, `Notebook names can be at most ${MAX_NAME} characters.`);
	return name;
}

function assertNameFree(userId: string, name: string, exceptId = '') {
	const taken = getDb()
		.prepare('SELECT name FROM notebooks WHERE user_id = ? AND name = ? AND id != ?')
		.get(userId, name, exceptId) as { name: string } | undefined;
	if (taken) error(409, `You already have a notebook called “${taken.name}”.`);
}

export function listNotebooks(userId: string): Notebook[] {
	const rows = getDb()
		.prepare(`SELECT b.id, b.name, b.created_at, ${COUNT} FROM notebooks b WHERE b.user_id = ? ORDER BY b.name`)
		.all(userId);
	return (rows as unknown as NotebookRow[]).map(toNotebook);
}

export function getNotebook(userId: string, id: string): Notebook | null {
	const row = getDb()
		.prepare(`SELECT b.id, b.name, b.created_at, ${COUNT} FROM notebooks b WHERE b.id = ? AND b.user_id = ?`)
		.get(id, userId);
	return row ? toNotebook(row as unknown as NotebookRow) : null;
}

export function notebookExists(userId: string, id: string): boolean {
	return !!getDb().prepare('SELECT 1 FROM notebooks WHERE id = ? AND user_id = ?').get(id, userId);
}

export function createNotebook(userId: string, body: Record<string, unknown>): Notebook {
	const name = parseName(body.name);
	assertNameFree(userId, name);
	const notebook: Notebook = { id: randomUUID(), name, noteCount: 0, createdAt: Date.now() };
	getDb()
		.prepare('INSERT INTO notebooks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
		.run(notebook.id, userId, name, notebook.createdAt);
	return notebook;
}

export function renameNotebook(userId: string, id: string, body: Record<string, unknown>): Notebook | null {
	const name = parseName(body.name);
	if (!notebookExists(userId, id)) return null;
	assertNameFree(userId, name, id);
	getDb().prepare('UPDATE notebooks SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId);
	return getNotebook(userId, id);
}

/** Deletes the notebook only; its notes stay, without a notebook. */
export function deleteNotebook(userId: string, id: string): boolean {
	const res = getDb().prepare('DELETE FROM notebooks WHERE id = ? AND user_id = ?').run(id, userId);
	return Number(res.changes) > 0;
}

/** The notebook with this name (ignoring case), created if needed. Used by imports. */
export function findOrCreateNotebook(userId: string, rawName: string): { id: string; created: boolean } {
	const name = rawName.trim().replace(/\s+/g, ' ');
	const existing = getDb().prepare('SELECT id FROM notebooks WHERE user_id = ? AND name = ?').get(userId, name) as
		| { id: string }
		| undefined;
	if (existing) return { id: existing.id, created: false };
	return { id: createNotebook(userId, { name }).id, created: true };
}
