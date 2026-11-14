import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson } from '#lib/server/http.ts';
import { authenticate, createSession, setSessionCookie } from '#lib/server/auth.ts';

export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const user = await authenticate(body.username, body.password);
	if (!user) error(401, 'That username and password don’t match an account.');
	const session = createSession(user.id);
	setSessionCookie(event, session.token, session.expiresAt);
	return json({ user });
};
