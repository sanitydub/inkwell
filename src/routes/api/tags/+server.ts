import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { listTags } from '#lib/server/notes.ts';

export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	return json({ tags: listTags(user.id) });
};
