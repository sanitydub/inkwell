import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireUser, tooManyAttempts } from '#lib/server/http.ts';
import { checkPassword, countOtherSessions, parsePassword, setPassword } from '#lib/server/auth.ts';
import { failedLoginsByUser } from '#lib/server/rate-limit.ts';

// POST /api/me/password { currentPassword, newPassword }: changes your password and signs out
// your other devices. Wrong current passwords count toward the sign-in limit.
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const token = event.locals.sessionToken!;
	const body = await readJson(event.request);
	const key = user.username.toLowerCase();

	const wait = failedLoginsByUser.retryAfter(key);
	if (wait) return tooManyAttempts(wait, 'wrong passwords');
	if (!(await checkPassword(user.id, body.currentPassword))) {
		failedLoginsByUser.record(key);
		error(400, 'Your current password isn’t right.');
	}
	const newPassword = parsePassword(body.newPassword, 'New passwords');
	if (newPassword === body.currentPassword) error(400, 'Choose a password that’s different from your current one.');

	const signedOut = countOtherSessions(user.id, token);
	await setPassword(user.id, newPassword, token);
	return json({ otherSessionsSignedOut: signedOut });
};
