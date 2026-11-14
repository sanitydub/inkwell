import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireUser } from '#lib/server/http.ts';
import { createNote, isView, listNotes } from '#lib/server/notes.ts';

// GET /api/notes?view=all|pinned|trash&q=search+words
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const view = event.url.searchParams.get('view') ?? 'all';
	if (!isView(view)) error(400, 'view must be one of: all, pinned, trash.');
	const q = (event.url.searchParams.get('q') ?? '').slice(0, 200);
	return json({ notes: listNotes(user.id, view, q) });
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const note = createNote(user.id, await readJson(event.request));
	return json(note, { status: 201 });
};
