import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireUser } from '#lib/server/http.ts';
import { getPreferences, updatePreferences } from '#lib/server/preferences.ts';

// GET: your preferences. PATCH { noteSort: { by, order } }: changes them for every device.
export const GET: RequestHandler = (event) => json(getPreferences(requireUser(event).id));

export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	return json(updatePreferences(user.id, await readJson(event.request)));
};
