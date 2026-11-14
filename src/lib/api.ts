import type { Note, Notebook, NotePatch, NoteSummary, TagCount, User, View } from './types';

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
	let res: Response;
	try {
		res = await fetch(`/api${path}`, {
			method,
			headers: {
				accept: 'application/json',
				...(body === undefined ? {} : { 'content-type': 'application/json' })
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
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
