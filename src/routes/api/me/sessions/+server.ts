import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { countOtherSessions, deleteOtherSessions } from '#lib/server/auth.ts';

// GET: how many other devices are signed in. DELETE: sign them all out.
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	return json({ otherSessions: countOtherSessions(user.id, event.locals.sessionToken!) });
};

export const DELETE: RequestHandler = (event) => {
	const user = requireUser(event);
	return json({ signedOut: deleteOtherSessions(user.id, event.locals.sessionToken!) });
};
