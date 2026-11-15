import type { Backlink, ManagedUser, Note, Notebook, NotePatch, NoteSummary, NoteTitle, TagCount, User, View } from './types';

export interface NoteQuery {
	view: View;
	q?: string;
	notebook?: string | null;
	tag?: string | null;
}

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

const OFFLINE = 'Can’t reach the server. Check your connection and try again.';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	return send<T>(method, path, {
		headers: body === undefined ? {} : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function send<T>(method: string, path: string, init: { headers?: Record<string, string>; body?: BodyInit }): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`/api${path}`, { method, headers: { accept: 'application/json', ...init.headers }, body: init.body });
	} catch {
		throw new ApiError(0, OFFLINE);
	}
	if (!res.ok) {
		let message = `The server answered with an error (${res.status}).`;
		try {
			const data = await res.json();
			if (typeof data?.message === 'string') message = data.message;
		} catch {
			/* not JSON */
		}
		throw new ApiError(res.status, message);
	}
	return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface ImportResult {
	imported: number;
	notebooksCreated: string[];
	skipped: string[];
}

const notePath = (id: string) => `/notes/${encodeURIComponent(id)}`;

export const api = {
	register: (username: string, password: string) =>
		request<{ user: User }>('POST', '/auth/register', { username, password }),
	login: (username: string, password: string) =>
		request<{ user: User }>('POST', '/auth/login', { username, password }),
	logout: () => request<void>('POST', '/auth/logout'),

	listNotes: (query: NoteQuery) => {
		const params = new URLSearchParams({ view: query.view });
		if (query.q) params.set('q', query.q);
		if (query.notebook) params.set('notebook', query.notebook);
		if (query.tag) params.set('tag', query.tag);
		return request<{ notes: NoteSummary[] }>('GET', `/notes?${params}`);
	},
	getNote: (id: string) => request<Note>('GET', notePath(id)),
	createNote: (fields: { title?: string; content?: string; notebookId?: string | null } = {}) =>
		request<Note>('POST', '/notes', fields),
	updateNote: (id: string, patch: NotePatch) => request<Note>('PATCH', notePath(id), patch),
	deleteNote: (id: string) => request<void>('DELETE', notePath(id)),
	emptyTrash: () => request<{ deleted: number }>('DELETE', '/trash'),

	listNotebooks: () => request<{ notebooks: Notebook[] }>('GET', '/notebooks'),
	createNotebook: (name: string) => request<Notebook>('POST', '/notebooks', { name }),
	renameNotebook: (id: string, name: string) =>
		request<Notebook>('PATCH', `/notebooks/${encodeURIComponent(id)}`, { name }),
	deleteNotebook: (id: string) => request<void>('DELETE', `/notebooks/${encodeURIComponent(id)}`),
	listTags: () => request<{ tags: TagCount[] }>('GET', '/tags'),
	listTitles: () => request<{ notes: NoteTitle[] }>('GET', '/titles'),
	listBacklinks: (id: string) => request<{ backlinks: Backlink[] }>('GET', `${notePath(id)}/backlinks`),

	changePassword: (currentPassword: string, newPassword: string) =>
		request<{ otherSessionsSignedOut: number }>('POST', '/me/password', { currentPassword, newPassword }),
	countOtherSessions: () => request<{ otherSessions: number }>('GET', '/me/sessions'),
	signOutOtherSessions: () => request<{ signedOut: number }>('DELETE', '/me/sessions'),

	listUsers: () => request<{ users: ManagedUser[] }>('GET', '/admin/users'),
	createUser: (username: string, password: string, isAdmin: boolean) =>
		request<ManagedUser>('POST', '/admin/users', { username, password, isAdmin }),
	updateUser: (id: string, patch: { password?: string; isAdmin?: boolean }) =>
		request<ManagedUser>('PATCH', `/admin/users/${encodeURIComponent(id)}`, patch),
	deleteUser: (id: string) => request<void>('DELETE', `/admin/users/${encodeURIComponent(id)}`),

	/** Uploads .md/.txt files and .zip archives; folders become notebooks. */
	async importFiles(files: File[]): Promise<ImportResult> {
		const form = new FormData();
		for (const file of files) form.append('files', file, file.name);
		try {
			return await send<ImportResult>('POST', '/import', { body: form });
		} catch (err) {
			if (err instanceof ApiError && err.status === 413) {
				throw new ApiError(413, 'That’s more than this server accepts in one upload. Import fewer files at a time, or raise BODY_SIZE_LIMIT.');
			}
			throw err;
		}
	},

	/** Best-effort save while the page is closing; the browser finishes the request for us. */
	saveOnExit(id: string, patch: NotePatch) {
		fetch(`/api${notePath(id)}`, {
			method: 'PATCH',
			keepalive: true,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		}).catch(() => {});
	}
};
