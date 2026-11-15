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
	/** Notes linking to it. `history` is true when only an earlier version of the note does. */
	usedBy: { id: string; title: string; history?: boolean }[];
}

/** What an API token may do: everything a signed-in session can (except account and admin settings), or only read. */
export type TokenScope = 'read' | 'write';

/** A personal access token as listed in Settings. The secret itself is only shown when it's created. */
export interface ApiToken {
	id: string;
	name: string;
	scope: TokenScope;
	/** The last four characters, to tell tokens apart. */
	lastFour: string;
	createdAt: number;
	lastUsedAt: number | null;
	/** Null when it never expires. */
	expiresAt: number | null;
}

/** An earlier version of a note, as listed in its history. */
export interface NoteVersionSummary {
	id: string;
	title: string;
	/** 'auto' while editing, 'before-restore' when kept just before another version was restored. */
	reason: 'auto' | 'before-restore';
	createdAt: number;
	/** Length of the text in characters. */
	size: number;
}

export interface NoteVersion extends NoteVersionSummary {
	content: string;
}
