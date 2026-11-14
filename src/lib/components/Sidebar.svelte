<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { FileArchive, FileText, FileUp, Hash, LogOut, Monitor, Moon, Notebook as NotebookIcon, Pin, Plus, Sun, Trash2 } from '@lucide/svelte';
	import type { User, View } from '#lib/types.ts';
	import type { Workspace } from '#lib/workspace.svelte.ts';

	interface Props {
		ws: Workspace;
		user: User;
		onnavigate?: () => void;
		onsignout: () => void;
	}

	let { ws, user, onnavigate, onsignout }: Props = $props();

	const views: { id: View; label: string; icon: typeof FileText }[] = [
		{ id: 'all', label: 'All notes', icon: FileText },
		{ id: 'pinned', label: 'Pinned', icon: Pin },
		{ id: 'trash', label: 'Trash', icon: Trash2 }
	];

	const isViewActive = (id: View) => ws.view === id && !ws.notebookId && !ws.tag;

	function go(action: () => unknown) {
		action();
		onnavigate?.();
	}

	// ---- New notebook (inline input) ----------------------------------------

	let creating = $state(false);
	let newName = $state('');
	let submitting = false;
	let nameInput = $state<HTMLInputElement>();

	async function startCreate() {
		creating = true;
		newName = '';
		await tick();
		nameInput?.focus();
	}

	// Called on Enter and on blur; removing the input after success also blurs it, hence the guards.
	async function finishCreate() {
		if (submitting || !creating) return;
		const name = newName.trim();
		if (!name) {
			creating = false;
			return;
		}
		submitting = true;
		const ok = await ws.createNotebook(name);
		submitting = false;
		if (ok) {
			newName = '';
			creating = false;
			onnavigate?.();
		} else {
			nameInput?.focus();
		}
	}

	let fileInput = $state<HTMLInputElement>();

	// The server sends the zip as an attachment, so the page stays put while it downloads.
	async function exportAll() {
		await ws.flush();
		location.href = '/api/export';
	}

	// ---- Theme ----------------------------------------------------------------

	type Theme = 'system' | 'light' | 'dark';
	const THEME_KEY = 'inkwell-theme';
	const nextTheme: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
	const themeLabel: Record<Theme, string> = {
		system: 'Theme: match system',
		light: 'Theme: light',
		dark: 'Theme: dark'
	};
	let theme = $state<Theme>('system');

	onMount(() => {
		try {
			const saved = localStorage.getItem(THEME_KEY);
			if (saved === 'light' || saved === 'dark') theme = saved;
		} catch {
			/* storage unavailable */
		}
	});

	function cycleTheme() {
		theme = nextTheme[theme];
		const root = document.documentElement;
		if (theme === 'system') delete root.dataset.theme;
		else root.dataset.theme = theme;
		try {
			if (theme === 'system') localStorage.removeItem(THEME_KEY);
			else localStorage.setItem(THEME_KEY, theme);
		} catch {
			/* storage unavailable */
		}
	}
</script>

<nav class="sidebar" aria-label="Notes">
	<p class="brand">Inkwell</p>

	<div class="scroll">
		<ul class="items">
			{#each views as v (v.id)}
				<li>
					<button class="item" aria-current={isViewActive(v.id) ? 'page' : undefined} onclick={() => go(() => ws.setView(v.id))}>
						<v.icon size={16} strokeWidth={1.75} />
						<span class="name">{v.label}</span>
					</button>
				</li>
			{/each}
		</ul>

		<section class="group" aria-labelledby="notebooks-heading">
			<div class="group-head">
				<h2 id="notebooks-heading">Notebooks</h2>
				<button class="icon-btn add" onclick={startCreate} aria-label="New notebook" title="New notebook">
					<Plus size={15} />
				</button>
			</div>
			<ul class="items">
				{#each ws.notebooks as nb (nb.id)}
					<li>
						<button
							class="item"
							aria-current={ws.notebookId === nb.id ? 'page' : undefined}
							onclick={() => go(() => ws.showNotebook(nb.id))}
						>
							<NotebookIcon size={16} strokeWidth={1.75} />
							<span class="name">{nb.name}</span>
							{#if nb.noteCount}<span class="count">{nb.noteCount}</span>{/if}
						</button>
					</li>
				{/each}
				{#if creating}
					<li>
						<form
							class="new"
							onsubmit={(e) => {
								e.preventDefault();
								finishCreate();
							}}
						>
							<NotebookIcon size={16} strokeWidth={1.75} />
							<input
								bind:this={nameInput}
								bind:value={newName}
								placeholder="Notebook name"
								aria-label="New notebook name"
								maxlength="100"
								onblur={finishCreate}
								onkeydown={(e) => {
									if (e.key === 'Escape') {
										newName = '';
										creating = false;
									}
								}}
							/>
						</form>
					</li>
				{/if}
			</ul>
			{#if !ws.notebooks.length && !creating}
				<p class="hint">Use <span aria-hidden="true">+</span><span class="visually-hidden">New notebook</span> to group related notes.</p>
			{/if}
		</section>

		<section class="group" aria-labelledby="tags-heading">
			<div class="group-head">
				<h2 id="tags-heading">Tags</h2>
			</div>
			{#if ws.tags.length}
				<ul class="items">
					{#each ws.tags as t (t.name)}
						<li>
							<button class="item tag" aria-current={ws.tag === t.name ? 'page' : undefined} onclick={() => go(() => ws.showTag(t.name))}>
								<Hash size={15} strokeWidth={1.75} />
								<span class="name">{t.name}</span>
								<span class="count">{t.noteCount}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="hint">Type a word starting with # in any note, like #recipes, to tag it.</p>
			{/if}
		</section>
	</div>

	<div class="foot">
		<span class="user" title="Signed in as {user.username}">{user.username}</span>
		<button class="icon-btn" onclick={cycleTheme} aria-label={themeLabel[theme]} title={themeLabel[theme]}>
			{#if theme === 'light'}
				<Sun size={16} />
			{:else if theme === 'dark'}
				<Moon size={16} />
			{:else}
				<Monitor size={16} />
			{/if}
		</button>
		<button
			class="icon-btn"
			onclick={() => fileInput?.click()}
			disabled={ws.importing}
			aria-label="Import notes"
			title="Import Markdown files or a zip"
		>
			<FileUp size={16} />
		</button>
		<input
			bind:this={fileInput}
			type="file"
			multiple
			hidden
			accept=".md,.markdown,.txt,.zip,text/markdown,text/plain,application/zip"
			onchange={(e) => {
				ws.importFiles([...(e.currentTarget.files ?? [])]);
				e.currentTarget.value = '';
			}}
		/>
		<button class="icon-btn" onclick={exportAll} aria-label="Export all notes" title="Export all notes as a zip">
			<FileArchive size={16} />
		</button>
		<button class="icon-btn" onclick={onsignout} aria-label="Sign out" title="Sign out">
			<LogOut size={16} />
		</button>
	</div>
</nav>

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--panel);
		padding: 0.75rem 0 0.75rem;
	}
	.brand {
		margin: 0.35rem 1.2rem 1.4rem;
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.55rem;
		font-weight: 500;
		line-height: 1;
		letter-spacing: -0.01em;
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 0.6rem 1rem;
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.item,
	.new {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		height: 2.1rem;
		padding: 0 0.6rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--muted);
		font-size: 0.9rem;
		text-align: left;
	}
	.item :global(svg) {
		flex: none;
	}
	.item:hover {
		background: var(--panel-strong);
		color: var(--ink);
	}
	.item[aria-current='page'] {
		background: var(--panel-strong);
		color: var(--ink);
		font-weight: 600;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		color: var(--faint);
		font-size: 0.75rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.new {
		background: var(--paper);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.new input {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--ink);
	}

	.group {
		margin-top: 1.4rem;
	}
	.group-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 1.75rem;
		margin-bottom: 0.2rem;
		padding-left: 0.6rem;
	}
	h2 {
		margin: 0;
		color: var(--muted);
		font-size: 0.78rem;
		font-weight: 600;
	}
	.add {
		width: 1.75rem;
		height: 1.75rem;
	}
	.hint {
		margin: 0.15rem 0.6rem 0;
		color: var(--muted);
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.foot {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		margin: 0 0.6rem;
		padding: 0.6rem 0 0 0.6rem;
		border-top: 1px solid var(--line);
	}
	.user {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
