import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, tooManyAttempts } from '#lib/server/http.ts';
import { createSession, createUser, parseNewCredentials, registrationOpen, setSessionCookie } from '#lib/server/auth.ts';
import { signupsByIp } from '#lib/server/rate-limit.ts';

export const POST: RequestHandler = async (event) => {
	if (!registrationOpen()) {
		error(403, 'New accounts are turned off on this server. Ask its admin to create one for you.');
	}
	const ip = event.getClientAddress();
	const wait = signupsByIp.retryAfter(ip);
	if (wait) return tooManyAttempts(wait, 'new accounts from this network');

	const { username, password } = parseNewCredentials(await readJson(event.request));
	const user = await createUser(username, password);
	signupsByIp.record(ip);

	const session = createSession(user.id);
	setSessionCookie(event, session.token, session.expiresAt);
	return json({ user }, { status: 201 });
};
