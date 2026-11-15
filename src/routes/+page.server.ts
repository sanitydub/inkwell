import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getPreferences } from '#lib/server/preferences.ts';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { user: locals.user, preferences: getPreferences(locals.user.id) };
};
