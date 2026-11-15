import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/http.ts';
import { deleteUnusedAttachments, listAttachments, storeAttachment } from '#lib/server/attachments.ts';

// GET: your attachments with the notes that use them.
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	return json({ attachments: listAttachments(user.id) });
};

// POST multipart/form-data with one or more "files": stores them and returns ready-to-insert Markdown.
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	let form: FormData;
	try {
		form = await event.request.formData();
	} catch {
		error(400, 'Send the files as multipart form data, in a field named "files".');
	}
	const uploads = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
	if (!uploads.length) error(400, 'Choose at least one file to attach.');
	const attachments = [];
	for (const file of uploads) attachments.push(storeAttachment(user.id, file.name, Buffer.from(await file.arrayBuffer())));
	return json({ attachments }, { status: 201 });
};

// DELETE ?unused=true: deletes every attachment no note links to.
export const DELETE: RequestHandler = (event) => {
	const user = requireUser(event);
	if (event.url.searchParams.get('unused') !== 'true') error(400, 'To delete one attachment, use /api/attachments/<id>. To delete all unused ones, add ?unused=true.');
	return json(deleteUnusedAttachments(user.id));
};
