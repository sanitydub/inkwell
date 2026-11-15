import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { revokeToken } from '#lib/server/tokens.ts';

// DELETE: revokes a token. Anything using it stops working straight away.
export const DELETE: RequestHandler = (event) => {
	const user = requireUser(event);
	if (!revokeToken(user.id, event.params.id)) error(404, 'That token doesn’t exist, or it was already revoked.');
	return new Response(null, { status: 204 });
};
