import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireUser } from '#lib/server/http.ts';
import { createNote, isView, listNotes } from '#lib/server/notes.ts';
import { normalizeTag } from '#lib/tags.ts';

// GET /api/notes?view=all|pinned|trash&q=search+words&notebook=<id>&tag=<name>
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const params = event.url.searchParams;
	const view = params.get('view') ?? 'all';
	if (!isView(view)) error(400, 'view must be one of: all, pinned, trash.');
	const rawTag = params.get('tag');
	const tag = rawTag === null ? null : normalizeTag(rawTag);
	if (rawTag !== null && !tag) error(400, `"${rawTag}" isn’t a valid tag.`);
	return json({
		notes: listNotes(user.id, {
			view,
			q: (params.get('q') ?? '').slice(0, 200),
			notebookId: params.get('notebook'),
			tag
		})
	});
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const note = createNote(user.id, await readJson(event.request));
	return json(note, { status: 201 });
};
