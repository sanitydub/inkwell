import { api, ApiError } from './api';
import { snippetFrom } from './snippet';
import type { Note, NotePatch, NoteSummary, View } from './types';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const SAVE_DELAY = 600;
const RETRY_DELAY = 5000;
const SEARCH_DELAY = 180;

/** All client-side state for the notes screen: the list, the open note, and autosave. */
export class Workspace {
	view = $state<View>('all');
	query = $state('');
	notes = $state<NoteSummary[]>([]);
	loading = $state(true);
	current = $state<Note | null>(null);
	saveState = $state<SaveState>('idle');
	message = $state<string | null>(null);
	/** Set when a note was just created, so the editor can put the cursor in its title. */
	freshNoteId = $state<string | null>(null);

	#dirty = false;
	#saveTimer: ReturnType<typeof setTimeout> | undefined;
	#searchTimer: ReturnType<typeof setTimeout> | undefined;
	#saveQueue: Promise<void> = Promise.resolve();
	#listSeq = 0;

	get hasUnsavedChanges() {
		return this.#dirty;
	}

	async refresh() {
		const seq = ++this.#listSeq;
		try {
			const { notes } = await api.listNotes(this.view, this.query.trim());
			if (seq === this.#listSeq) this.notes = notes;
		} catch (err) {
			if (seq === this.#listSeq) this.#fail(err);
		} finally {
			if (seq === this.#listSeq) this.loading = false;
		}
	}

	async setView(view: View) {
		if (view === this.view) return;
		this.view = view;
		this.notes = [];
		this.loading = true;
		await this.refresh();
	}

	setQuery(query: string) {
		this.query = query;
		clearTimeout(this.#searchTimer);
		this.#searchTimer = setTimeout(() => this.refresh(), SEARCH_DELAY);
	}

	async open(id: string) {
		if (this.current?.id === id) return;
		await this.flush();
		try {
			this.current = await api.getNote(id);
			this.saveState = 'idle';
		} catch (err) {
			this.#fail(err);
		}
	}

	async close() {
		await this.flush();
		this.current = null;
	}

	async create() {
		await this.flush();
		this.query = '';
		if (this.view === 'trash') this.view = 'all';
		try {
			const note = await api.createNote();
			this.current = note;
			this.saveState = 'idle';
			this.freshNoteId = note.id;
			await this.refresh();
		} catch (err) {
			this.#fail(err);
		}
	}

	/** Records a local edit and schedules an autosave. */
	edit(fields: { title?: string; content?: string }) {
		const note = this.current;
		if (!note || note.trashed) return;
		Object.assign(note, fields);

		const summary = this.notes.find((n) => n.id === note.id);
		if (summary) {
			if (fields.title !== undefined) summary.title = fields.title;
			if (fields.content !== undefined) summary.snippet = snippetFrom(fields.content);
		}

		this.#dirty = true;
		this.saveState = 'pending';
		clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => this.flush(), SAVE_DELAY);
	}

	/** Saves any pending edits now. Saves run one at a time, in order. */
	flush(): Promise<void> {
		clearTimeout(this.#saveTimer);
		this.#saveQueue = this.#saveQueue.then(() => this.#save());
		return this.#saveQueue;
	}

	/** Called when the tab is closing: hand the last edits to the browser to deliver. */
	saveOnExit() {
		const note = this.current;
		if (!this.#dirty || !note) return;
		api.saveOnExit(note.id, { title: note.title, content: note.content });
		this.#dirty = false;
	}

	async #save() {
		const note = this.current;
		if (!this.#dirty || !note) return;
		this.#dirty = false;
		this.saveState = 'saving';
		try {
			const saved = await api.updateNote(note.id, { title: note.title, content: note.content });
			note.updatedAt = saved.updatedAt;
			const summary = this.notes.find((n) => n.id === note.id);
			if (summary) summary.updatedAt = saved.updatedAt;
			if (!this.#dirty) this.saveState = 'saved';
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				this.message = 'This note was deleted somewhere else, so your latest edits weren’t saved.';
				this.saveState = 'error';
				return;
			}
			if (err instanceof ApiError && err.status === 401) return this.#fail(err);
			// Keep the edits and try again shortly.
			this.#dirty = true;
			this.saveState = 'error';
			clearTimeout(this.#saveTimer);
			this.#saveTimer = setTimeout(() => this.flush(), RETRY_DELAY);
		}
	}

	async #patch(patch: NotePatch) {
		const note = this.current;
		if (!note) return null;
		await this.flush();
		try {
			const saved = await api.updateNote(note.id, patch);
			if (this.current?.id === note.id) {
				Object.assign(this.current, { pinned: saved.pinned, trashed: saved.trashed });
			}
			await this.refresh();
			return saved;
		} catch (err) {
			this.#fail(err);
			return null;
		}
	}

	togglePin() {
		return this.#patch({ pinned: !this.current?.pinned });
	}

	async moveToTrash() {
		if (await this.#patch({ trashed: true })) this.current = null;
	}

	restore() {
		return this.#patch({ trashed: false });
	}

	async deleteForever() {
		const note = this.current;
		if (!note) return;
		try {
			await api.deleteNote(note.id);
			this.current = null;
			await this.refresh();
		} catch (err) {
			this.#fail(err);
		}
	}

	async emptyTrash() {
		try {
			await api.emptyTrash();
			if (this.current?.trashed) this.current = null;
			await this.refresh();
		} catch (err) {
			this.#fail(err);
		}
	}

	#fail(err: unknown) {
		if (err instanceof ApiError && err.status === 401) {
			location.href = '/login';
			return;
		}
		this.message = err instanceof Error ? err.message : String(err);
	}
}
