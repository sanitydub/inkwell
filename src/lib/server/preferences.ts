import { error } from '@sveltejs/kit';
import { getDb } from './db';
import { DEFAULT_SORT, isNoteSort, type NoteSort } from '#lib/types.ts';

// Settings that follow a person to every device, stored on their account.

export interface UserPreferences {
	noteSort: NoteSort;
}

export function getPreferences(userId: string): UserPreferences {
	const row = getDb().prepare('SELECT note_sort FROM users WHERE id = ?').get(userId) as { note_sort: string | null } | undefined;
	const [by, order] = (row?.note_sort ?? '').split('-');
	const sort = { by, order };
	return { noteSort: isNoteSort(sort) ? sort : DEFAULT_SORT };
}

/** Applies { noteSort } and returns the preferences as now saved. */
export function updatePreferences(userId: string, body: Record<string, unknown>): UserPreferences {
	if (!('noteSort' in body)) error(400, 'Send the preferences to change, e.g. { "noteSort": { "by": "title", "order": "asc" } }.');
	const sort = body.noteSort;
	if (!isNoteSort(sort)) error(400, 'noteSort must look like { "by": "updated" | "created" | "title", "order": "asc" | "desc" }.');
	getDb().prepare('UPDATE users SET note_sort = ? WHERE id = ?').run(`${sort.by}-${sort.order}`, userId);
	return getPreferences(userId);
}
