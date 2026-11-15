import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireUser } from '#lib/server/http.ts';
import { relinkCandidates, relinkNotes } from '#lib/server/notes.ts';

// After renaming a note: which notes still [[link]] to its old title (GET ?from=Old title),
// and pointing those links at the new title (POST { from }).

const NOT_FOUND = 'This note doesn’t exist, or it was deleted.';

export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const notes = relinkCandidates(user.id, event.params.id, event.url.searchParams.get('from') ?? '');
	if (!notes) error(404, NOT_FOUND);
	return json({ notes });
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const { from } = await readJson(event.request);
	if (typeof from !== 'string' || !from.trim()) error(400, 'Send the old title as "from".');
	const updated = relinkNotes(user.id, event.params.id, from);
	if (!updated) error(404, NOT_FOUND);
	return json({ updated });
};
