import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from './http';
import { readAttachment } from './attachments';

/**
 * Sends an attachment to its owner. Only verified images display inline; everything else downloads.
 * nosniff and a sandbox policy stop a file being run as a page even if a browser tries.
 */
export function serveAttachment(event: RequestEvent, id: string): Response {
	const user = requireUser(event);
	const found = readAttachment(user.id, id);
	if (!found) error(404, 'This attachment doesn’t exist, or it was deleted.');
	const { attachment, data, inline } = found;
	const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`;
	return new Response(new Uint8Array(data), {
		headers: {
			'content-type': inline ? attachment.type : attachment.type.startsWith('text/') ? 'text/plain; charset=utf-8' : 'application/octet-stream',
			'content-length': String(data.length),
			'content-disposition': disposition,
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox",
			// Attachment ids never change content, so browsers can keep them; private keeps shared caches out.
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
}
