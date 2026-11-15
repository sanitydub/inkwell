import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { restoreNoteVersion } from '#lib/server/notes.ts';

// POST /api/notes/:id/versions/:vid/restore: puts that version back. The note as it was is kept
// as a version first, so the restore can be undone. Returns the updated note.
export const POST: RequestHandler = (event) => {
	const user = requireUser(event);
	const note = restoreNoteVersion(user.id, event.params.id, event.params.vid);
	if (!note) error(404, 'That version doesn’t exist any more.');
	return json({ note });
};
