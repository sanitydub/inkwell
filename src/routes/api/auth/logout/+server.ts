import type { RequestHandler } from './$types';
import { clearSessionCookie, deleteSession } from '#lib/server/auth.ts';

export const POST: RequestHandler = (event) => {
	if (event.locals.sessionToken) deleteSession(event.locals.sessionToken);
	clearSessionCookie(event);
	return new Response(null, { status: 204 });
};
