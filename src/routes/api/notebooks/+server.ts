import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireUser } from '#lib/server/http.ts';
import { createNotebook, listNotebooks } from '#lib/server/notebooks.ts';

export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	return json({ notebooks: listNotebooks(user.id) });
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	return json(createNotebook(user.id, await readJson(event.request)), { status: 201 });
};
