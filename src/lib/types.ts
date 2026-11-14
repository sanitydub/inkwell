// Shapes shared by the server API and every client (web today, native later).

export interface User {
	id: string;
	username: string;
	createdAt: number;
}

export type View = 'all' | 'pinned' | 'trash';

export interface NoteSummary {
	id: string;
	title: string;
	snippet: string;
	pinned: boolean;
	trashed: boolean;
	notebookId: string | null;
	updatedAt: number;
}

export interface Note {
	id: string;
	title: string;
	content: string;
	pinned: boolean;
	trashed: boolean;
	notebookId: string | null;
	/** Derived from #tags in the content; read-only. */
	tags: string[];
	createdAt: number;
	updatedAt: number;
}

export interface NotePatch {
	title?: string;
	content?: string;
	pinned?: boolean;
	trashed?: boolean;
	notebookId?: string | null;
}

export interface Notebook {
	id: string;
	name: string;
	/** Notes in the notebook, not counting the trash. */
	noteCount: number;
	createdAt: number;
}

export interface TagCount {
	name: string;
	/** Notes with this exact tag, not counting the trash. */
	noteCount: number;
}

export interface NoteTitle {
	id: string;
	title: string;
}

/** A note that links to another, with the line that holds the link. */
export interface Backlink {
	id: string;
	title: string;
	context: string;
}
