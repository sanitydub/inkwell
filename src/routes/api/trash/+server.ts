import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { emptyTrash } from '#lib/server/notes.ts';

export const DELETE: RequestHandler = (event) => {
	const user = requireUser(event);
	return json({ deleted: emptyTrash(user.id) });
};
