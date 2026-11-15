import type { RequestHandler } from './$types';
import { serveAttachment } from '#lib/server/serve-attachment.ts';

// The name is only there so links read well and downloads get the right filename.
export const GET: RequestHandler = (event) => serveAttachment(event, event.params.id);
