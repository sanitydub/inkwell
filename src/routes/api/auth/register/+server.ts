import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson } from '#lib/server/http.ts';
import { createSession, createUser, parseNewCredentials, registrationOpen, setSessionCookie } from '#lib/server/auth.ts';

export const POST: RequestHandler = async (event) => {
	if (!registrationOpen()) {
		error(403, 'New accounts are turned off on this server. Ask its admin to create one for you.');
	}
	const { username, password } = parseNewCredentials(await readJson(event.request));
	const user = await createUser(username, password);
	const session = createSession(user.id);
	setSessionCookie(event, session.token, session.expiresAt);
	return json({ user }, { status: 201 });
};
