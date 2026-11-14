// How a note looks as a standalone .md file: YAML front matter (read by Obsidian, Joplin and most
// Markdown tools) followed by the note text unchanged. Used by single-note downloads and the zip export.

interface NoteForFile {
	title: string;
	content: string;
	pinned: boolean;
	createdAt: number;
	updatedAt: number;
}

export function noteToMarkdown(note: NoteForFile): string {
	const header = [
		'---',
		// JSON strings are valid YAML double-quoted strings, so any title is safe.
		`title: ${JSON.stringify(note.title)}`,
		`created: ${new Date(note.createdAt).toISOString()}`,
		`updated: ${new Date(note.updatedAt).toISOString()}`,
		...(note.pinned ? ['pinned: true'] : []),
		'---',
		''
	];
	// Always exactly one extra newline, which the import removes again, so round trips are exact.
	return header.join('\n') + note.content + '\n';
}

/** A file or folder name that works on Windows, macOS and Linux. */
export function safeFileName(name: string, fallback = 'Untitled'): string {
	let safe = name
		.replace(/[\\/]+/g, '-')
		.replace(/[:*?"<>|\u0000-\u001f]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+|[. ]+$/g, '')
		.slice(0, 100)
		.trim();
	if (!safe) safe = fallback;
	if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(safe)) safe = `_${safe}`;
	return safe;
}
