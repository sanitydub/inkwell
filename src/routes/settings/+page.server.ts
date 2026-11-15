import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ALLOW_REGISTRATION } from '$app/env/private';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { user: locals.user, signupsOpen: ALLOW_REGISTRATION };
};
