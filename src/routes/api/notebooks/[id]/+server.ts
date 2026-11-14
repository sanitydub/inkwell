import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireUser } from '#lib/server/http.ts';
import { deleteNotebook, getNotebook, renameNotebook } from '#lib/server/notebooks.ts';

const NOT_FOUND = 'This notebook doesn’t exist, or it was deleted.';

export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const notebook = getNotebook(user.id, event.params.id);
	if (!notebook) error(404, NOT_FOUND);
	return json(notebook);
};

// Only the name can change.
export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	const notebook = renameNotebook(user.id, event.params.id, await readJson(event.request));
	if (!notebook) error(404, NOT_FOUND);
	return json(notebook);
};

// Notes in the notebook are kept, without a notebook.
export const DELETE: RequestHandler = (event) => {
	const user = requireUser(event);
	if (!deleteNotebook(user.id, event.params.id)) error(404, NOT_FOUND);
	return new Response(null, { status: 204 });
};
