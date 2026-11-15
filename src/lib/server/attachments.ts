import { error } from '@sveltejs/kit';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_ATTACHMENT_SIZE } from '$app/env/private';
import { dataDirectory, getDb } from './db';
import type { Attachment, AttachmentUsage } from '#lib/types.ts';

// Images and files attached to notes. Each user's files live in DATA_DIR/attachments/<user id>/,
// named by attachment id only, so an uploaded file's name never reaches the filesystem.
// Notes link to them as /api/attachments/<id>/<name>.

interface AttachmentRow {
	id: string;
	user_id: string;
	name: string;
	type: string;
	size: number;
	sha256: string;
	created_at: number;
}

const URL_PREFIX = '/api/attachments/';

/** Images browsers may show inline. Everything else (including SVG and HTML) downloads. */
const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

const TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	svg: 'image/svg+xml',
	pdf: 'application/pdf',
	txt: 'text/plain',
	md: 'text/markdown',
	csv: 'text/csv',
	json: 'application/json',
	zip: 'application/zip',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	html: 'text/html',
	htm: 'text/html'
};

/** The type from the file name. Uploaders' claimed types aren't trusted. */
const typeFromName = (name: string) => TYPES[/\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? ''] ?? 'application/octet-stream';

/** True only if the bytes really are the image format the name claims, so it's safe to show inline. */
function isInlineImage(type: string, data: Buffer): boolean {
	if (!INLINE_IMAGES.has(type)) return false;
	const head = data.subarray(0, 16);
	switch (type) {
		case 'image/png':
			return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
		case 'image/jpeg':
			return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
		case 'image/gif':
			return head.toString('latin1', 0, 4) === 'GIF8';
		case 'image/webp':
			return head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
		case 'image/avif':
			return head.toString('latin1', 4, 8) === 'ftyp' && /avi[fs]/.test(head.toString('latin1', 8, 12));
	}
	return false;
}

/** A display name that's safe in Markdown and HTTP headers: no paths, control characters or brackets. */
export function cleanAttachmentName(raw: string): string {
	const base = raw.split(/[\\/]/).pop() ?? '';
	let name = base.replace(/[\u0000-\u001f\u007f[\]<>"]/g, '').replace(/\s+/g, ' ').trim();
	if (!name || name === '.' || name === '..') name = 'file';
	if (name.length > 120) {
		const ext = /\.[a-z0-9]{1,10}$/i.exec(name)?.[0] ?? '';
		name = name.slice(0, 120 - ext.length) + ext;
	}
	return name;
}

const userFolder = (userId: string) => join(dataDirectory(), 'attachments', userId);
const filePath = (userId: string, id: string) => join(userFolder(userId), id);

export const attachmentUrl = (id: string, name: string) => `${URL_PREFIX}${id}/${encodeURIComponent(name)}`;

function toAttachment(r: AttachmentRow, displayName = r.name): Attachment {
	const url = attachmentUrl(r.id, displayName);
	const label = displayName.replace(/\.[a-z0-9]{1,10}$/i, '');
	return {
		id: r.id,
		name: displayName,
		type: r.type,
		size: r.size,
		createdAt: r.created_at,
		url,
		markdown: INLINE_IMAGES.has(r.type) ? `![${label}](${url})` : `[${displayName}](${url})`
	};
}

/**
 * Stores a file for a user and returns it. Uploading the same bytes again reuses the stored copy.
 * Throws a 413 if it's over MAX_ATTACHMENT_SIZE.
 */
export function storeAttachment(userId: string, rawName: string, data: Buffer): Attachment {
	if (data.length > MAX_ATTACHMENT_SIZE) {
		const mb = (MAX_ATTACHMENT_SIZE / 1024 / 1024).toFixed(MAX_ATTACHMENT_SIZE % (1024 * 1024) ? 1 : 0);
		error(413, `“${cleanAttachmentName(rawName)}” is too big. Attachments can be up to ${mb} MB.`);
	}
	const name = cleanAttachmentName(rawName);
	const sha256 = createHash('sha256').update(data).digest('hex');
	const db = getDb();

	const existing = db
		.prepare('SELECT * FROM attachments WHERE user_id = ? AND sha256 = ? AND size = ?')
		.get(userId, sha256, data.length) as AttachmentRow | undefined;
	if (existing && existsSync(filePath(userId, existing.id))) return toAttachment(existing, name);

	let type = typeFromName(name);
	// An image whose bytes don't match its name is stored as a plain download.
	if (INLINE_IMAGES.has(type) && !isInlineImage(type, data)) type = 'application/octet-stream';

	const row: AttachmentRow = { id: randomUUID(), user_id: userId, name, type, size: data.length, sha256, created_at: Date.now() };
	mkdirSync(userFolder(userId), { recursive: true });
	writeFileSync(filePath(userId, row.id), data, { mode: 0o600 });
	db.prepare('INSERT INTO attachments (id, user_id, name, type, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
		row.id,
		userId,
		name,
		type,
		row.size,
		sha256,
		row.created_at
	);
	return toAttachment(row);
}

/** The attachment and its bytes, if it belongs to this user. */
export function readAttachment(userId: string, id: string): { attachment: Attachment; data: Buffer; inline: boolean } | null {
	const row = getDb().prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ?').get(id, userId) as
		| AttachmentRow
		| undefined;
	if (!row) return null;
	const path = filePath(userId, row.id);
	if (!existsSync(path)) return null;
	const data = readFileSync(path);
	return { attachment: toAttachment(row), data, inline: isInlineImage(row.type, data) };
}

/**
 * Notes (including ones in the trash) that link to this attachment, in their text or in an earlier
 * version. Files only an earlier version uses are marked `history`, and still count as used so
 * restoring that version never brings back a broken image.
 */
function notesUsing(userId: string, id: string): AttachmentUsage['usedBy'] {
	const db = getDb();
	const link = URL_PREFIX + id;
	const current = db
		.prepare("SELECT id, title FROM notes WHERE user_id = ? AND content LIKE '%' || ? || '%' ORDER BY updated_at DESC")
		.all(userId, link) as unknown as { id: string; title: string }[];
	const seen = new Set(current.map((n) => n.id));
	const inHistory = (
		db
			.prepare(
				`SELECT DISTINCT n.id, n.title FROM note_versions v JOIN notes n ON n.id = v.note_id
				 WHERE n.user_id = ? AND v.content LIKE '%' || ? || '%' ORDER BY n.updated_at DESC`
			)
			.all(userId, link) as unknown as { id: string; title: string }[]
	).filter((n) => !seen.has(n.id));
	return [...current, ...inHistory.map((n) => ({ ...n, history: true }))];
}

export function listAttachments(userId: string): AttachmentUsage[] {
	const rows = getDb()
		.prepare('SELECT * FROM attachments WHERE user_id = ? ORDER BY created_at DESC')
		.all(userId) as unknown as AttachmentRow[];
	return rows.map((r) => ({ ...toAttachment(r), usedBy: notesUsing(userId, r.id) }));
}

export function deleteAttachment(userId: string, id: string): boolean {
	const res = getDb().prepare('DELETE FROM attachments WHERE id = ? AND user_id = ?').run(id, userId);
	if (!Number(res.changes)) return false;
	const path = filePath(userId, id);
	if (existsSync(path)) unlinkSync(path);
	return true;
}

/** Deletes every attachment no note (or earlier version of one) links to. Returns how many and how many bytes were freed. */
export function deleteUnusedAttachments(userId: string): { deleted: number; freedBytes: number } {
	let deleted = 0;
	let freedBytes = 0;
	for (const a of listAttachments(userId)) {
		if (a.usedBy.length) continue;
		if (deleteAttachment(userId, a.id)) {
			deleted++;
			freedBytes += a.size;
		}
	}
	return { deleted, freedBytes };
}

/** Removes a deleted user's files (their database rows go with the account). */
export function removeUserAttachments(userId: string) {
	rmSync(userFolder(userId), { recursive: true, force: true });
}

/** Ids of attachments linked from a piece of Markdown, in order. */
export function attachmentIdsIn(markdown: string): string[] {
	return [...markdown.matchAll(/\/api\/attachments\/([0-9a-f-]{36})\//g)].map((m) => m[1]);
}

/** Every attachment of a user with its bytes, for the zip export. Missing files are left out. */
export function attachmentsForExport(userId: string): { id: string; name: string; createdAt: number; data: Buffer }[] {
	const rows = getDb()
		.prepare('SELECT * FROM attachments WHERE user_id = ? ORDER BY created_at')
		.all(userId) as unknown as AttachmentRow[];
	return rows
		.filter((r) => existsSync(filePath(userId, r.id)))
		.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, data: readFileSync(filePath(userId, r.id)) }));
}

/** Rewrites attachment links in Markdown, e.g. to relative paths for an export. */
export const replaceAttachmentLinks = (markdown: string, replace: (id: string) => string | null) =>
	markdown.replace(/\/api\/attachments\/([0-9a-f-]{36})\/[^)\s]*/g, (whole, id: string) => replace(id) ?? whole);
