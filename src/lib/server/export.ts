import { getDb } from './db';
import { createZip, type ZipEntry } from './zip';
import { attachmentsForExport, cleanAttachmentName, replaceAttachmentLinks } from './attachments';
import { noteToMarkdown, safeFileName } from '#lib/note-file.ts';

interface ExportRow {
	title: string;
	content: string;
	pinned: number;
	created_at: number;
	updated_at: number;
	notebook: string | null;
}

/**
 * All of a user's notes outside the trash as a zip: one folder per notebook, one .md file per note,
 * and an attachments/ folder. Links to attachments become relative paths into that folder, so the
 * export also works in other Markdown apps (and imports back into Inkwell).
 */
export function exportNotes(userId: string): Buffer {
	const attachments = attachmentsForExport(userId);
	const attachmentPaths = new Map<string, string>();
	const takenNames = new Set<string>();
	for (const a of attachments) {
		const name = cleanAttachmentName(a.name);
		const dot = name.lastIndexOf('.');
		const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
		let file = name;
		for (let i = 2; takenNames.has(file.toLowerCase()); i++) file = `${stem} (${i})${ext}`;
		takenNames.add(file.toLowerCase());
		attachmentPaths.set(a.id, `attachments/${file}`);
	}

	const rows = getDb()
		.prepare(
			`SELECT n.title, n.content, n.pinned, n.created_at, n.updated_at, b.name AS notebook
			 FROM notes n LEFT JOIN notebooks b ON b.id = n.notebook_id
			 WHERE n.user_id = ? AND n.trashed_at IS NULL ORDER BY n.created_at`
		)
		.all(userId) as unknown as ExportRow[];

	const used = new Set<string>();
	const entries: ZipEntry[] = rows.map((r) => {
		const folder = r.notebook ? `${safeFileName(r.notebook, 'Notebook')}/` : '';
		const base = safeFileName(r.title);
		let path = `${folder}${base}.md`;
		// Same title twice: "Ideas.md", "Ideas (2).md", … (case-insensitive, for Windows and macOS).
		for (let i = 2; used.has(path.toLowerCase()); i++) path = `${folder}${base} (${i}).md`;
		used.add(path.toLowerCase());
		// From a notebook folder, attachments are one level up.
		const up = folder ? '../' : '';
		const content = replaceAttachmentLinks(r.content, (id) => {
			const target = attachmentPaths.get(id);
			return target ? up + target.split('/').map(encodeURIComponent).join('/') : null;
		});
		return {
			path,
			modified: new Date(r.updated_at),
			data: noteToMarkdown({
				title: r.title,
				content,
				pinned: r.pinned === 1,
				createdAt: r.created_at,
				updatedAt: r.updated_at
			})
		};
	});
	for (const a of attachments) {
		entries.push({ path: attachmentPaths.get(a.id)!, data: a.data, modified: new Date(a.createdAt) });
	}
	return createZip(entries);
}
