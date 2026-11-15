import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { deleteAttachment } from '#lib/server/attachments.ts';
import { serveAttachment } from '#lib/server/serve-attachment.ts';

export const GET: RequestHandler = (event) => serveAttachment(event, event.params.id);

export const DELETE: RequestHandler = (event) => {
	const user = requireUser(event);
	if (!deleteAttachment(user.id, event.params.id)) error(404, 'This attachment doesn’t exist, or it was deleted.');
	return new Response(null, { status: 204 });
};
