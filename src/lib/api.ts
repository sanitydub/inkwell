import type { Note, NotePatch, NoteSummary, User, View } from './types';

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

	listNotes: (view: View, q: string) =>
		request<{ notes: NoteSummary[] }>('GET', `/notes?${new URLSearchParams(q ? { view, q } : { view })}`),
	getNote: (id: string) => request<Note>('GET', notePath(id)),
	createNote: (fields: { title?: string; content?: string } = {}) => request<Note>('POST', '/notes', fields),
	updateNote: (id: string, patch: NotePatch) => request<Note>('PATCH', notePath(id), patch),
	deleteNote: (id: string) => request<void>('DELETE', notePath(id)),
	emptyTrash: () => request<{ deleted: number }>('DELETE', '/trash'),

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
