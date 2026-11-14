import { api, ApiError } from './api';
import { snippetFrom } from './snippet';
import { normalizeTitle } from './links';
import type { Backlink, Note, Notebook, NotePatch, NoteSummary, NoteTitle, TagCount, View } from './types';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const SAVE_DELAY = 600;
const RETRY_DELAY = 5000;
const SEARCH_DELAY = 180;

const VIEW_NAMES: Record<View, string> = { all: 'All notes', pinned: 'Pinned', trash: 'Trash' };

/** All client-side state for the notes screen: filters, the list, the open note, and autosave. */
export class Workspace {
	// What the list shows: a view, optionally narrowed to one notebook or one tag.
	view = $state<View>('all');
	notebookId = $state<string | null>(null);
	tag = $state<string | null>(null);
	query = $state('');

	notes = $state<NoteSummary[]>([]);
	loading = $state(true);
	notebooks = $state<Notebook[]>([]);
	tags = $state<TagCount[]>([]);

	/** Every note title outside the trash, newest first: used to resolve and suggest [[links]]. */
	titles = $state<NoteTitle[]>([]);
	/** Normalized title → note id; the most recently edited note wins when titles repeat. */
	titleIndex = $derived.by(() => {
		const index = new Map<string, string>();
		for (const t of this.titles) {
			const key = normalizeTitle(t.title);
			if (key && !index.has(key)) index.set(key, t.id);
		}
		return index;
	});

	current = $state<Note | null>(null);
	/** Notes that link to the open note. */
	backlinks = $state<Backlink[]>([]);
	saveState = $state<SaveState>('idle');
	message = $state<string | null>(null);
	/** Set when a note was just created, so the editor can put the cursor in its title. */
	freshNoteId = $state<string | null>(null);

	#dirty = false;
	#saveTimer: ReturnType<typeof setTimeout> | undefined;
	#searchTimer: ReturnType<typeof setTimeout> | undefined;
	#saveQueue: Promise<void> = Promise.resolve();
	#listSeq = 0;
	/** The open note's title as last saved, to notice renames (which change titles and backlinks). */
	#savedTitle = '';

	get hasUnsavedChanges() {
		return this.#dirty;
	}

	/** Name of what the list is showing, e.g. "All notes", a notebook's name, or "#recipes". */
	get heading(): string {
		if (this.notebookId) return this.notebooks.find((n) => n.id === this.notebookId)?.name ?? 'Notebook';
		if (this.tag) return `#${this.tag}`;
		return VIEW_NAMES[this.view];
	}

	notebookName(id: string | null): string | null {
		return (id && this.notebooks.find((n) => n.id === id)?.name) || null;
	}

	// ---- Loading ------------------------------------------------------------

	async refresh() {
		const seq = ++this.#listSeq;
		try {
			const { notes } = await api.listNotes({
				view: this.view,
				q: this.query.trim(),
				notebook: this.notebookId,
				tag: this.tag
			});
			if (seq === this.#listSeq) this.notes = notes;
		} catch (err) {
			if (seq === this.#listSeq) this.#fail(err);
		} finally {
			if (seq === this.#listSeq) this.loading = false;
		}
	}

	/** Reloads the sidebar's notebooks and tags (and their counts). */
	async refreshSidebar() {
		try {
			const [{ notebooks }, { tags }] = await Promise.all([api.listNotebooks(), api.listTags()]);
			this.notebooks = notebooks;
			this.tags = tags;
		} catch (err) {
			this.#fail(err);
		}
	}

	async refreshTitles() {
		try {
			this.titles = (await api.listTitles()).notes;
		} catch (err) {
			this.#fail(err);
		}
	}

	async #loadBacklinks() {
		const id = this.current?.id;
		if (!id) return;
		try {
			const { backlinks } = await api.listBacklinks(id);
			if (this.current?.id === id) this.backlinks = backlinks;
		} catch {
			// Not worth interrupting anyone over; the list just stays as it was.
		}
	}

	#opened(note: Note) {
		this.current = note;
		this.saveState = 'idle';
		this.backlinks = [];
		this.#savedTitle = note.title;
		this.#loadBacklinks();
	}

	async #show(view: View, notebookId: string | null, tag: string | null) {
		if (view === this.view && notebookId === this.notebookId && tag === this.tag) return;
		this.view = view;
		this.notebookId = notebookId;
		this.tag = tag;
		this.notes = [];
		this.loading = true;
		await this.refresh();
	}

	setView(view: View) {
		return this.#show(view, null, null);
	}

	showNotebook(id: string) {
		return this.#show('all', id, null);
	}

	showTag(tag: string) {
		return this.#show('all', null, tag);
	}

	setQuery(query: string) {
		this.query = query;
		clearTimeout(this.#searchTimer);
		this.#searchTimer = setTimeout(() => this.refresh(), SEARCH_DELAY);
	}

	// ---- Notes --------------------------------------------------------------

	async open(id: string) {
		if (this.current?.id === id) return;
		await this.flush();
		try {
			this.#opened(await api.getNote(id));
		} catch (err) {
			this.#fail(err);
		}
	}

	async close() {
		await this.flush();
		this.current = null;
	}

	/** Opens the note a [[link]] points to, or creates it if no note has that title yet. */
	async openByTitle(title: string) {
		const id = this.titleIndex.get(normalizeTitle(title));
		if (id) return this.open(id);
		await this.create({ title: title.trim() });
	}

	/**
	 * Creates a note in whatever notebook or tag is being viewed, so it shows up in the list.
	 * With a title (from following a [[link]]), the cursor goes to the body instead of the title.
	 */
	async create(options: { title?: string } = {}) {
		await this.flush();
		this.query = '';
		if (this.view !== 'all') this.view = 'all';
		try {
			const note = await api.createNote({
				title: options.title,
				notebookId: this.notebookId,
				content: this.tag ? `#${this.tag} ` : ''
			});
			this.#opened(note);
			if (!options.title) this.freshNoteId = note.id;
			await Promise.all([this.refresh(), this.refreshSidebar(), this.refreshTitles()]);
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
			if (saved.title !== this.#savedTitle && this.current?.id === note.id) {
				this.#savedTitle = saved.title;
				this.refreshTitles();
				this.#loadBacklinks();
			}
			const tagsChanged = saved.tags.join('\n') !== note.tags.join('\n');
			note.updatedAt = saved.updatedAt;
			note.tags = saved.tags;
			const summary = this.notes.find((n) => n.id === note.id);
			if (summary) summary.updatedAt = saved.updatedAt;
			if (!this.#dirty) this.saveState = 'saved';
			if (tagsChanged) this.refreshSidebar();
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
				Object.assign(this.current, {
					pinned: saved.pinned,
					trashed: saved.trashed,
					notebookId: saved.notebookId
				});
			}
			await Promise.all([this.refresh(), this.refreshSidebar(), 'trashed' in patch && this.refreshTitles()]);
			return saved;
		} catch (err) {
			this.#fail(err);
			return null;
		}
	}

	togglePin() {
		return this.#patch({ pinned: !this.current?.pinned });
	}

	moveToNotebook(notebookId: string | null) {
		return this.#patch({ notebookId });
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
			await Promise.all([this.refresh(), this.refreshSidebar(), this.refreshTitles()]);
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

	// ---- Notebooks ----------------------------------------------------------

	/** Creates a notebook and shows it. Returns false (with a message shown) if it failed. */
	async createNotebook(name: string): Promise<boolean> {
		try {
			const notebook = await api.createNotebook(name);
			await this.refreshSidebar();
			await this.showNotebook(notebook.id);
			return true;
		} catch (err) {
			this.#fail(err);
			return false;
		}
	}

	async renameNotebook(id: string, name: string): Promise<boolean> {
		try {
			await api.renameNotebook(id, name);
			await this.refreshSidebar();
			return true;
		} catch (err) {
			this.#fail(err);
			return false;
		}
	}

	/** Deletes the notebook; its notes stay in All notes. */
	async deleteNotebook(id: string) {
		try {
			await api.deleteNotebook(id);
			if (this.current?.notebookId === id) this.current.notebookId = null;
			if (this.notebookId === id) await this.setView('all');
			await this.refreshSidebar();
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
