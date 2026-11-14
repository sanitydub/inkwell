import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { listBacklinks } from '#lib/server/notes.ts';

// GET /api/notes/:id/backlinks: notes that [[link]] to this one, with the line that links.
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const backlinks = listBacklinks(user.id, event.params.id);
	if (!backlinks) error(404, 'This note doesn’t exist, or it was deleted.');
	return json({ backlinks });
};
