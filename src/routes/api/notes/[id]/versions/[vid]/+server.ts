import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { getVersion } from '#lib/server/versions.ts';

// GET /api/notes/:id/versions/:vid: one earlier version with its title and text.
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const version = getVersion(user.id, event.params.id, event.params.vid);
	if (!version) error(404, 'That version doesn’t exist any more.');
	return json({ version });
};
