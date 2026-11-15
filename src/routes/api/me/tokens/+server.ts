import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireUser } from '#lib/server/http.ts';
import { createToken, listTokens } from '#lib/server/tokens.ts';

// Personal access tokens. Managed only from a signed-in session (the auth hook refuses tokens here).

// GET: your tokens, without their secrets.
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	return json({ tokens: listTokens(user.id) });
};

// POST { name, scope: "read" | "write", expiresInDays: 30 | 90 | 365 | null }: returns the token and,
// this once only, its secret.
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	return json(createToken(user.id, await readJson(event.request)), { status: 201 });
};
