import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireUser } from '#lib/server/http.ts';
import { createNote, isView, listNotes } from '#lib/server/notes.ts';
import { getPreferences } from '#lib/server/preferences.ts';
import { normalizeTag } from '#lib/tags.ts';
import type { NoteSort } from '#lib/types.ts';

// GET /api/notes?view=all|pinned|trash&q=search+words&notebook=<id>&tag=<name>&sort=updated|created|title&order=asc|desc
// Without sort and order, the list uses the order saved in the user's preferences.
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const params = event.url.searchParams;
	const view = params.get('view') ?? 'all';
	if (!isView(view)) error(400, 'view must be one of: all, pinned, trash.');
	const rawTag = params.get('tag');
	const tag = rawTag === null ? null : normalizeTag(rawTag);
	if (rawTag !== null && !tag) error(400, `"${rawTag}" isn’t a valid tag.`);
	const saved = getPreferences(user.id).noteSort;
	const by = params.get('sort') ?? saved.by;
	const order = params.get('order') ?? (params.has('sort') ? (by === 'title' ? 'asc' : 'desc') : saved.order);
	if (by !== 'updated' && by !== 'created' && by !== 'title') error(400, 'sort must be one of: updated, created, title.');
	if (order !== 'asc' && order !== 'desc') error(400, 'order must be asc or desc.');
	const sort: NoteSort = { by, order };
	return json({
		notes: listNotes(user.id, {
			view,
			q: (params.get('q') ?? '').slice(0, 200),
			notebookId: params.get('notebook'),
			tag,
			sort
		})
	});
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const note = createNote(user.id, await readJson(event.request));
	return json(note, { status: 201 });
};
