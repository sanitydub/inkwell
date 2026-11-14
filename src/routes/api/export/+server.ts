import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { exportNotes } from '#lib/server/export.ts';

// GET /api/export: a zip of every note outside the trash, grouped into folders by notebook.
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const zip = exportNotes(user.id);
	const day = new Date().toISOString().slice(0, 10);
	return new Response(new Uint8Array(zip), {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="inkwell-export-${day}.zip"`,
			'content-length': String(zip.length),
			'cache-control': 'no-store'
		}
	});
};
