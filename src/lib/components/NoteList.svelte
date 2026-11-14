<script lang="ts">
	import { tick } from 'svelte';
	import { Menu, Pencil, Pin, Plus, Search, Trash2 } from '@lucide/svelte';
	import { shortDate } from '#lib/format.ts';
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

	function confirmEmptyTrash() {
		const n = ws.notes.length;
		if (confirm(`Delete ${n === 1 ? 'this note' : `all ${n} notes`} in the trash forever? This can’t be undone.`)) {
			ws.emptyTrash();
		}
	}
</script>

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
								<time datetime={new Date(note.updatedAt).toISOString()}>{shortDate(note.updatedAt)}</time>
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
