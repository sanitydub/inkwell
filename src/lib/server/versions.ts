import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import type { NoteVersion, NoteVersionSummary } from '#lib/types.ts';

// Version history. The editor autosaves constantly, so not every save becomes a version: before a
// save is written, the note as it was is kept if the last version is over SNAPSHOT_EVERY old or the
// change is large. Old versions are thinned out so each note keeps at most MAX_VERSIONS.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SNAPSHOT_EVERY = 10 * MINUTE;
const BIG_CHANGE_CHARS = 500;
const BIG_CHANGE_SHARE = 0.3;
/** Short notes change by a large share all the time; below this many characters that doesn't count. */
const MIN_SHARE_CHARS = 100;
const MAX_VERSIONS = 50;

export type VersionReason = 'auto' | 'before-restore';

interface VersionRow {
	id: string;
	note_id: string;
	title: string;
	content: string;
	reason: VersionReason;
	created_at: number;
}

/** Roughly how many characters changed: everything between the common start and the common end. */
function changedChars(a: string, b: string): number {
	let start = 0;
	const limit = Math.min(a.length, b.length);
	while (start < limit && a[start] === b[start]) start++;
	let end = 0;
	while (end < limit - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
	return Math.max(a.length, b.length) - start - end;
}

function latest(noteId: string) {
	return getDb()
		.prepare('SELECT title, content, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at DESC LIMIT 1')
		.get(noteId) as { title: string; content: string; created_at: number } | undefined;
}

function insertVersion(noteId: string, title: string, content: string, reason: VersionReason, createdAt: number) {
	getDb()
		.prepare('INSERT INTO note_versions (id, note_id, title, content, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.run(randomUUID(), noteId, title, content, reason, createdAt);
}

/**
 * Called before a note's title or text is overwritten. Keeps the note as it was when it's worth it.
 * Call inside the same transaction as the update.
 */
export function snapshotBeforeSave(noteId: string, next: { title?: string; content?: string }) {
	const db = getDb();
	const current = db.prepare('SELECT title, content, updated_at FROM notes WHERE id = ?').get(noteId) as
		| { title: string; content: string; updated_at: number }
		| undefined;
	if (!current) return;
	const nextTitle = next.title ?? current.title;
	const nextContent = next.content ?? current.content;
	if (nextTitle === current.title && nextContent === current.content) return;
	// A brand-new empty note has nothing worth keeping.
	if (!current.title.trim() && !current.content.trim()) return;

	const last = latest(noteId);
	if (last && last.title === current.title && last.content === current.content) return;

	const changed = changedChars(current.content, nextContent) + (nextTitle !== current.title ? 1 : 0);
	const big =
		changed >= BIG_CHANGE_CHARS || (changed >= MIN_SHARE_CHARS && changed > current.content.length * BIG_CHANGE_SHARE);
	const stale = !last || Date.now() - last.created_at >= SNAPSHOT_EVERY;
	if (!stale && !big) return;

	// Dated when that text was last edited, which is what "the version from 2:13" should mean.
	insertVersion(noteId, current.title, current.content, 'auto', current.updated_at);
	prune(noteId);
}

/** Keeps every version from the last day, one per hour for the last week, one per day before that, at most MAX_VERSIONS. */
function prune(noteId: string) {
	const db = getDb();
	const rows = db
		.prepare('SELECT id, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at DESC')
		.all(noteId) as unknown as { id: string; created_at: number }[];
	const now = Date.now();
	const seenBuckets = new Set<string>();
	const remove: string[] = [];
	let kept = 0;
	for (const row of rows) {
		const age = now - row.created_at;
		const bucket = age < DAY ? `v:${row.id}` : age < 7 * DAY ? `h:${Math.floor(row.created_at / HOUR)}` : `d:${Math.floor(row.created_at / DAY)}`;
		// Newest first, so the first version seen in each hour or day is the one kept.
		if (seenBuckets.has(bucket) || kept >= MAX_VERSIONS) remove.push(row.id);
		else {
			seenBuckets.add(bucket);
			kept++;
		}
	}
	const del = db.prepare('DELETE FROM note_versions WHERE id = ?');
	for (const id of remove) del.run(id);
}

const ownsNote = (userId: string, noteId: string) =>
	!!getDb().prepare('SELECT 1 FROM notes WHERE id = ? AND user_id = ?').get(noteId, userId);

/** The versions of a note, newest first, without their text. Null if the note isn't the user's. */
export function listVersions(userId: string, noteId: string): NoteVersionSummary[] | null {
	if (!ownsNote(userId, noteId)) return null;
	const rows = getDb()
		.prepare(
			'SELECT id, title, reason, created_at, length(content) AS size FROM note_versions WHERE note_id = ? ORDER BY created_at DESC'
		)
		.all(noteId) as unknown as (Omit<VersionRow, 'content' | 'note_id'> & { size: number })[];
	return rows.map((r) => ({ id: r.id, title: r.title, reason: r.reason, createdAt: r.created_at, size: Number(r.size) }));
}

export function getVersion(userId: string, noteId: string, versionId: string): NoteVersion | null {
	if (!ownsNote(userId, noteId)) return null;
	const r = getDb().prepare('SELECT * FROM note_versions WHERE id = ? AND note_id = ?').get(versionId, noteId) as
		| VersionRow
		| undefined;
	return r
		? { id: r.id, title: r.title, content: r.content, reason: r.reason, createdAt: r.created_at, size: r.content.length }
		: null;
}

/**
 * Keeps the note as it is now, so a restore can itself be undone. The caller then writes the
 * version back. Call inside the same transaction.
 */
export function prepareRestore(noteId: string, version: NoteVersion) {
	const current = getDb().prepare('SELECT title, content FROM notes WHERE id = ?').get(noteId) as
		| { title: string; content: string }
		| undefined;
	if (!current) return;
	const last = latest(noteId);
	const alreadyKept = last && last.title === current.title && last.content === current.content;
	if (!alreadyKept && (current.title !== version.title || current.content !== version.content)) {
		insertVersion(noteId, current.title, current.content, 'before-restore', Date.now());
		prune(noteId);
	}
}
