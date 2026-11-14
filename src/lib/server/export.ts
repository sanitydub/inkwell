import { getDb } from './db';
import { createZip, type ZipEntry } from './zip';
import { noteToMarkdown, safeFileName } from '#lib/note-file.ts';

interface ExportRow {
	title: string;
	content: string;
	pinned: number;
	created_at: number;
	updated_at: number;
	notebook: string | null;
}

/** All of a user's notes outside the trash as a zip: one folder per notebook, one .md file per note. */
export function exportNotes(userId: string): Buffer {
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
		return {
			path,
			modified: new Date(r.updated_at),
			data: noteToMarkdown({
				title: r.title,
				content: r.content,
				pinned: r.pinned === 1,
				createdAt: r.created_at,
				updatedAt: r.updated_at
			})
		};
	});
	return createZip(entries);
}
