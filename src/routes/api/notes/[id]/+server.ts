import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireUser } from '#lib/server/http.ts';
import { deleteNote, getNote, updateNote } from '#lib/server/notes.ts';

const NOT_FOUND = 'This note doesn’t exist, or it was deleted.';

export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const note = getNote(user.id, event.params.id);
	if (!note) error(404, NOT_FOUND);
	return json(note);
};

export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	const note = updateNote(user.id, event.params.id, await readJson(event.request));
	if (!note) error(404, NOT_FOUND);
	return json(note);
};

// Permanent. The UI only offers this for notes already in the trash.
export const DELETE: RequestHandler = (event) => {
	const user = requireUser(event);
	if (!deleteNote(user.id, event.params.id)) error(404, NOT_FOUND);
	return new Response(null, { status: 204 });
};
