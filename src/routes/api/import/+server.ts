import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { importNotes, isJunk, stripCommonRoot, type ImportFile } from '#lib/server/import.ts';
import { readZip, ZipError } from '#lib/server/unzip.ts';

// POST /api/import (multipart/form-data, one or more "files"): .md/.txt and Word .docx files, and .zip archives of them.
// Folders inside a zip become notebooks.
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);

	let form: FormData;
	try {
		form = await event.request.formData();
	} catch {
		error(400, 'Send the files as multipart form data, in a field named "files".');
	}
	const uploads = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
	if (!uploads.length) error(400, 'Choose at least one Markdown (.md), Word (.docx) or .zip file to import.');

	const files: ImportFile[] = [];
	const skipped: string[] = [];
	for (const upload of uploads) {
		const data = Buffer.from(await upload.arrayBuffer());
		if (/\.zip$/i.test(upload.name)) {
			try {
				const zip = readZip(data);
				// Junk like __MACOSX/ would otherwise hide the folder that wraps everything.
				files.push(...stripCommonRoot(zip.files.filter((f) => !isJunk(f.path))));
				skipped.push(...zip.skipped.map((s) => `${upload.name}: ${s}`));
			} catch (err) {
				if (err instanceof ZipError) error(400, `${upload.name}: ${err.message}`);
				throw err;
			}
		} else {
			files.push({ path: upload.name, data, modified: new Date(upload.lastModified || Date.now()) });
		}
	}

	return json(importNotes(user.id, files, skipped));
};
