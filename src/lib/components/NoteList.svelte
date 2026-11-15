<script lang="ts">
	import { tick } from 'svelte';
	import { ArrowDownWideNarrow, ArrowUpNarrowWide, Check, Menu, Pencil, Pin, Plus, Search, Trash2 } from '@lucide/svelte';
	import { shortDate } from '#lib/format.ts';
	import type { NoteSort } from '#lib/types.ts';
	import type { Workspace } from '#lib/workspace.svelte.ts';

	interface Props {
		ws: Workspace;
		onopenmenu: () => void;
		searchInput?: HTMLInputElement;
	}

	let { ws, onopenmenu, searchInput = $bindable() }: Props = $props();

	// ---- Renaming the notebook being viewed ----------------------------------

	let renaming = $state(false);
	let draftName = $state('');
	let renameInput = $state<HTMLInputElement>();
	let submitting = false;

	async function startRename() {
		draftName = ws.heading;
		renaming = true;
		await tick();
		renameInput?.select();
	}

	async function finishRename() {
		const id = ws.notebookId;
		const name = draftName.trim();
		// Called on Enter and on blur; removing the input after success also blurs it.
		if (submitting || !renaming || !id) return;
		if (!name || name === ws.heading) {
			renaming = false;
			return;
		}
		submitting = true;
		const ok = await ws.renameNotebook(id, name);
		submitting = false;
		if (ok) renaming = false;
		else renameInput?.focus();
	}

	function confirmDeleteNotebook() {
		const id = ws.notebookId;
		if (!id) return;
		const n = ws.notebooks.find((nb) => nb.id === id)?.noteCount ?? 0;
		const notes = n === 0 ? '' : n === 1 ? ' Its note stays in All notes.' : ` Its ${n} notes stay in All notes.`;
		if (confirm(`Delete the notebook “${ws.heading}”?${notes}`)) ws.deleteNotebook(id);
	}

	// ---- Sort menu ------------------------------------------------------------

	const SORT_FIELDS: { by: NoteSort['by']; label: string }[] = [
		{ by: 'updated', label: 'Last edited' },
		{ by: 'created', label: 'Created' },
		{ by: 'title', label: 'Title' }
	];
	const ORDER_LABELS: Record<NoteSort['by'], { asc: string; desc: string }> = {
		updated: { desc: 'Newest first', asc: 'Oldest first' },
		created: { desc: 'Newest first', asc: 'Oldest first' },
		title: { asc: 'A to Z', desc: 'Z to A' }
	};

	let sortOpen = $state(false);
	let sortBox = $state<HTMLElement>();
	const searching = $derived(!!ws.query.trim());
	const sortLabel = $derived(
		searching
			? 'Search results are sorted by best match'
			: `Sorted by ${SORT_FIELDS.find((f) => f.by === ws.sort.by)?.label.toLowerCase()}, ${ORDER_LABELS[ws.sort.by][ws.sort.order].toLowerCase()}`
	);
	/** Rows show the date being sorted by: created when sorting by creation, last edited otherwise. */
	const dateOf = (note: { createdAt: number; updatedAt: number }) =>
		ws.sort.by === 'created' && !searching && ws.view !== 'trash' ? note.createdAt : note.updatedAt;

	function pickField(by: NoteSort['by']) {
		// Switching field starts with its natural direction: A to Z for titles, newest first for dates.
		ws.setSort({ by, order: by === ws.sort.by ? ws.sort.order : by === 'title' ? 'asc' : 'desc' });
	}

	function closeSortOnOutsideClick(e: MouseEvent) {
		if (sortOpen && sortBox && !sortBox.contains(e.target as Node)) sortOpen = false;
	}

	function confirmEmptyTrash() {
		const n = ws.notes.length;
		if (confirm(`Delete ${n === 1 ? 'this note' : `all ${n} notes`} in the trash forever? This can’t be undone.`)) {
			ws.emptyTrash();
		}
	}
</script>

<svelte:window onclick={closeSortOnOutsideClick} onkeydown={(e) => e.key === 'Escape' && (sortOpen = false)} />

<section class="list-pane" aria-label="Note list">
	<header>
		<div class="row">
			<button class="icon-btn menu" onclick={onopenmenu} aria-label="Open menu">
				<Menu size={18} />
			</button>
			{#if renaming}
				<form
					class="rename"
					onsubmit={(e) => {
						e.preventDefault();
						finishRename();
					}}
				>
					<input
						bind:this={renameInput}
						bind:value={draftName}
						aria-label="Notebook name"
						maxlength="100"
						onblur={finishRename}
						onkeydown={(e) => e.key === 'Escape' && (renaming = false)}
					/>
				</form>
			{:else}
				<h1 title={ws.heading}>{ws.heading}</h1>
			{/if}
			{#if ws.notebookId && !renaming}
				<button class="icon-btn" onclick={startRename} aria-label="Rename notebook" title="Rename notebook">
					<Pencil size={15} />
				</button>
				<button class="icon-btn" onclick={confirmDeleteNotebook} aria-label="Delete notebook" title="Delete notebook">
					<Trash2 size={15} />
				</button>
			{/if}
			{#if ws.view === 'trash'}
				<button class="btn danger" disabled={!ws.notes.length} onclick={confirmEmptyTrash}>Empty trash</button>
			{:else}
				<button class="btn primary" onclick={() => ws.create()}>
					<Plus size={16} strokeWidth={2.25} />
					New note
				</button>
			{/if}
		</div>
		<div class="search-row">
			<label class="search">
				<Search size={15} />
				<span class="visually-hidden">Search notes</span>
				<input
					bind:this={searchInput}
					type="search"
					placeholder="Search"
					autocomplete="off"
					value={ws.query}
					oninput={(e) => ws.setQuery(e.currentTarget.value)}
				/>
				<kbd aria-hidden="true">Ctrl K</kbd>
			</label>
			{#if ws.view !== 'trash'}
				<div class="sort" bind:this={sortBox}>
					<button
						class="icon-btn"
						aria-label="Sort notes"
						title={sortLabel}
						aria-haspopup="menu"
						aria-expanded={sortOpen}
						disabled={searching}
						onclick={() => (sortOpen = !sortOpen)}
					>
						{#if ws.sort.order === 'asc'}<ArrowUpNarrowWide size={16} />{:else}<ArrowDownWideNarrow size={16} />{/if}
					</button>
					{#if sortOpen}
						<div class="sort-menu" role="menu" aria-label="Sort notes">
							<p class="menu-label">Sort by</p>
							{#each SORT_FIELDS as f (f.by)}
								<button role="menuitemradio" aria-checked={ws.sort.by === f.by} onclick={() => pickField(f.by)}>
									<span class="tick">{#if ws.sort.by === f.by}<Check size={14} />{/if}</span>{f.label}
								</button>
							{/each}
							<hr />
							{#each ['desc', 'asc'] as const as order (order)}
								<button
									role="menuitemradio"
									aria-checked={ws.sort.order === order}
									onclick={() => ws.setSort({ by: ws.sort.by, order })}
								>
									<span class="tick">{#if ws.sort.order === order}<Check size={14} />{/if}</span>{ORDER_LABELS[ws.sort.by][order]}
								</button>
							{/each}
							{#if ws.view === 'all'}<p class="menu-note">Pinned notes stay at the top.</p>{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</header>

	<div class="items">
		{#if ws.loading}
			<p class="empty">Loading notes…</p>
		{:else if ws.notes.length === 0}
			<div class="empty">
				{#if ws.query.trim()}
					<p>No notes match “{ws.query.trim()}”.</p>
				{:else if ws.notebookId}
					<p>This notebook is empty.</p>
					<button class="btn" onclick={() => ws.create()}>Write a note in it</button>
				{:else if ws.tag}
					<p>No notes are tagged #{ws.tag} any more.</p>
				{:else if ws.view === 'trash'}
					<p>The trash is empty. Notes you delete wait here until you remove them for good.</p>
				{:else if ws.view === 'pinned'}
					<p>Nothing pinned. Pin a note to keep it here and at the top of All notes.</p>
				{:else}
					<p>No notes yet.</p>
					<button class="btn" onclick={() => ws.create()}>Write your first note</button>
				{/if}
			</div>
		{:else}
			<ul>
				{#each ws.notes as note (note.id)}
					<li>
						<button
							class="item"
							aria-current={ws.current?.id === note.id ? 'true' : undefined}
							onclick={() => ws.open(note.id)}
						>
							<span class="title" class:untitled={!note.title.trim()}>{note.title.trim() || 'Untitled'}</span>
							{#if note.snippet}<span class="snippet">{note.snippet}</span>{/if}
							<span class="meta">
								{#if note.pinned && ws.view !== 'pinned'}
									<Pin size={12} aria-label="Pinned" />
								{/if}
								<time datetime={new Date(dateOf(note)).toISOString()}>{shortDate(dateOf(note))}</time>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	.list-pane {
		display: flex;
		flex-direction: column;
		height: 100%;
		border-right: 1px solid var(--line);
	}
	header {
		padding: 0.75rem 0.75rem 0.6rem;
		flex: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.25rem;
		margin-bottom: 0.6rem;
	}
	h1 {
		flex: 1;
		min-width: 0;
		margin: 0 0 0 0.25rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 1rem;
		font-weight: 600;
	}
	.rename {
		flex: 1;
		min-width: 0;
	}
	.rename input {
		width: 100%;
		height: 2rem;
		padding: 0 0.5rem;
		border: 1px solid var(--accent);
		border-radius: var(--radius);
		outline: none;
		background: var(--paper);
		font-weight: 600;
	}
	.menu {
		display: none;
	}
	@media (max-width: 1024px) {
		.menu {
			display: inline-grid;
		}
		h1 {
			margin-left: 0;
		}
	}

	.search-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.search-row .search {
		flex: 1;
		min-width: 0;
	}
	.sort {
		position: relative;
		flex: none;
	}
	.sort .icon-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.sort .icon-btn[aria-expanded='true'] {
		background: var(--panel-strong);
		color: var(--ink);
	}
	.sort-menu {
		position: absolute;
		top: calc(100% + 0.3rem);
		right: 0;
		z-index: 15;
		width: 12.5rem;
		padding: 0.3rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--paper);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.14);
	}
	.sort-menu button {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: 0;
		border-radius: 4px;
		background: transparent;
		font-size: 0.875rem;
		text-align: left;
	}
	.sort-menu button:hover {
		background: var(--panel);
	}
	.tick {
		display: grid;
		width: 14px;
		color: var(--accent);
	}
	.menu-label,
	.menu-note {
		margin: 0;
		padding: 0.3rem 0.5rem 0.2rem;
		color: var(--faint);
		font-size: 0.75rem;
	}
	.menu-label {
		font-weight: 600;
	}
	.sort-menu hr {
		margin: 0.3rem 0;
		border: 0;
		border-top: 1px solid var(--line);
	}

	.search {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		height: 2.1rem;
		padding: 0 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		color: var(--faint);
		background: var(--paper);
	}
	.search:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--ink);
		font-size: 0.9rem;
	}
	.search input::placeholder {
		color: var(--faint);
	}
	kbd {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: var(--faint);
	}
	.search:focus-within kbd {
		display: none;
	}
	@media (hover: none) {
		kbd {
			display: none;
		}
	}

	.items {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 0.5rem 1rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1px;
	}
	.item {
		display: block;
		width: 100%;
		padding: 0.65rem 0.7rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		text-align: left;
	}
	.item:hover {
		background: var(--panel);
	}
	.item[aria-current='true'] {
		background: var(--accent-soft);
	}
	.title {
		display: block;
		font-weight: 600;
		font-size: 0.9375rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.item[aria-current='true'] .title {
		color: var(--accent);
	}
	.untitled {
		color: var(--faint);
		font-style: italic;
		font-weight: 500;
	}
	.snippet {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		margin-top: 0.15rem;
		color: var(--muted);
		font-size: 0.8125rem;
		line-height: 1.4;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.35rem;
		color: var(--faint);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.empty {
		padding: 1.5rem 0.75rem;
		color: var(--muted);
		font-size: 0.875rem;
	}
	.empty p {
		margin: 0 0 0.9rem;
		max-width: 30ch;
	}
</style>
