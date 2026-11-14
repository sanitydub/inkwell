import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { listTitles } from '#lib/server/notes.ts';

// GET /api/titles: every note title outside the trash, for resolving and suggesting [[links]].
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	return json({ notes: listTitles(user.id) });
};
