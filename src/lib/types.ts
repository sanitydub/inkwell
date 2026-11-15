// Shapes shared by the server API and every client (web today, native later).

export interface User {
	id: string;
	username: string;
	/** Admins can manage other accounts. The first account on a server is an admin. */
	isAdmin: boolean;
	createdAt: number;
}

/** An account as an admin sees it. */
export interface ManagedUser extends User {
	noteCount: number;
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

/** An uploaded image or file. Notes link to it with `url`. */
export interface Attachment {
	id: string;
	name: string;
	type: string;
	size: number;
	createdAt: number;
	url: string;
	/** Ready-to-insert Markdown: an image for images, a link for anything else. */
	markdown: string;
}

/** An attachment as listed in Settings, with the notes that link to it. */
export interface AttachmentUsage extends Attachment {
	usedBy: { id: string; title: string }[];
}
