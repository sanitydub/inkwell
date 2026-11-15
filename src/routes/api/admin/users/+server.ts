import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireAdmin } from '#lib/server/http.ts';
import { adminCreateUser, listUsers } from '#lib/server/users.ts';

// Admins only. Creating accounts works even when ALLOW_REGISTRATION is off.
export const GET: RequestHandler = (event) => {
	requireAdmin(event);
	return json({ users: listUsers() });
};

export const POST: RequestHandler = async (event) => {
	requireAdmin(event);
	return json(await adminCreateUser(await readJson(event.request)), { status: 201 });
};
