import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireAdmin } from '#lib/server/http.ts';
import { adminDeleteUser, adminUpdateUser } from '#lib/server/users.ts';

// PATCH { password?, isAdmin? }: reset a password (signs them out everywhere) or change admin status.
export const PATCH: RequestHandler = async (event) => {
	const admin = requireAdmin(event);
	return json(await adminUpdateUser(admin.id, event.params.id, await readJson(event.request)));
};

// Deletes the account with all its notes and notebooks.
export const DELETE: RequestHandler = (event) => {
	const admin = requireAdmin(event);
	adminDeleteUser(admin.id, event.params.id);
	return new Response(null, { status: 204 });
};
