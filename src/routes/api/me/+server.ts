import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';

export const GET: RequestHandler = (event) => json({ user: requireUser(event) });
