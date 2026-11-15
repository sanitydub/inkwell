import { error, json, type RequestEvent } from '@sveltejs/kit';
import type { User } from '#lib/types.ts';

export function requireUser(event: RequestEvent): User {
	if (!event.locals.user) error(401, 'Sign in to continue.');
	return event.locals.user;
}

export function requireAdmin(event: RequestEvent): User {
	const user = requireUser(event);
	if (!user.isAdmin) error(403, 'Only admins can manage accounts.');
	return user;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Send a JSON object in the request body.');
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		error(400, 'Send a JSON object in the request body.');
	}
	return body as Record<string, unknown>;
}

/** A 429 response telling the client when it may try again. */
export function tooManyAttempts(retryAfterMs: number, what: string): Response {
	const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
	return json(
		{ status: 429, message: `Too many ${what}. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` },
		{ status: 429, headers: { 'retry-after': String(Math.ceil(retryAfterMs / 1000)) } }
	);
}
