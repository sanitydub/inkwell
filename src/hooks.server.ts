import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, clearSessionCookie, setSessionCookie, validateSession } from '#lib/server/auth.ts';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.sessionToken = null;

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const session = validateSession(token);
		if (session) {
			event.locals.user = session.user;
			event.locals.sessionToken = token;
			if (session.renewed) setSessionCookie(event, token, session.expiresAt);
		} else {
			clearSessionCookie(event);
		}
	}

	return resolve(event);
};
