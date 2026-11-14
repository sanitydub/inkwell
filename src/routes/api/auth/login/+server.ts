import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, tooManyAttempts } from '#lib/server/http.ts';
import { authenticate, createSession, setSessionCookie } from '#lib/server/auth.ts';
import { failedLoginsByIp, failedLoginsByUser } from '#lib/server/rate-limit.ts';

export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const ip = event.getClientAddress();
	const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';

	// Checked before the password, so a blocked client learns nothing from further guesses.
	const wait = Math.max(failedLoginsByIp.retryAfter(ip), username ? failedLoginsByUser.retryAfter(username) : 0);
	if (wait) return tooManyAttempts(wait, 'failed sign-in attempts');

	const user = await authenticate(body.username, body.password);
	if (!user) {
		failedLoginsByIp.record(ip);
		if (username) failedLoginsByUser.record(username);
		error(401, 'That username and password don’t match an account.');
	}
	failedLoginsByUser.reset(username);

	const session = createSession(user.id);
	setSessionCookie(event, session.token, session.expiresAt);
	return json({ user });
};
