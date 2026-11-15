import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { listVersions } from '#lib/server/versions.ts';

// GET /api/notes/:id/versions: earlier versions of a note, newest first, without their text.
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const versions = listVersions(user.id, event.params.id);
	if (!versions) error(404, 'This note doesn’t exist, or it was deleted.');
	return json({ versions });
};
