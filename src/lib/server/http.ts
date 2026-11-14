import { error, type RequestEvent } from '@sveltejs/kit';
import type { User } from '#lib/types.ts';

export function requireUser(event: RequestEvent): User {
	if (!event.locals.user) error(401, 'Sign in to continue.');
	return event.locals.user;
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
