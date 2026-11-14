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
	updatedAt: number;
}

export interface Note {
	id: string;
	title: string;
	content: string;
	pinned: boolean;
	trashed: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface NotePatch {
	title?: string;
	content?: string;
	pinned?: boolean;
	trashed?: boolean;
}
