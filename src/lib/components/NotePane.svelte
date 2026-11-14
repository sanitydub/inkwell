<script lang="ts">
	import { tick } from 'svelte';
	import { ChevronDown, ChevronLeft, Download, Notebook as NotebookIcon, Pin, PinOff, RotateCcw, Trash2 } from '@lucide/svelte';
	import Editor from './Editor.svelte';
	import Preview from './Preview.svelte';
	import { longDate } from '#lib/format.ts';
	import { extractTags } from '#lib/tags.ts';
	import { noteToMarkdown, safeFileName } from '#lib/note-file.ts';
	import type { Workspace } from '#lib/workspace.svelte.ts';

	interface Props {
		ws: Workspace;
		onback: () => void;
	}

	let { ws, onback }: Props = $props();

	type Mode = 'write' | 'split' | 'read';
	const MODE_KEY = 'inkwell-mode';
	const modes: { id: Mode; label: string }[] = [
		{ id: 'write', label: 'Write' },
		{ id: 'split', label: 'Split' },
		{ id: 'read', label: 'Read' }
	];

	let mode = $state<Mode>(savedMode());
	let editor = $state<ReturnType<typeof Editor>>();
	let titleInput = $state<HTMLInputElement>();

	const note = $derived(ws.current);
	// Worked out locally so chips update as you type; the server indexes the same thing on save.
	const tags = $derived(note ? extractTags(note.content) : []);
	// Notes in the trash are read-only, so show them rendered.
	const shown = $derived<Mode>(note?.trashed ? 'read' : mode);

	const status = $derived.by(() => {
		if (!note) return '';
		switch (ws.saveState) {
			case 'pending':
			case 'saving':
				return 'Saving…';
			case 'saved':
				return 'Saved';
			case 'error':
				return 'Couldn’t save. Retrying…';
			default:
				return `Edited ${longDate(note.updatedAt)}`;
		}
	});

	// Put the cursor in the title of a note that was just created.
	$effect(() => {
		const fresh = ws.freshNoteId;
		if (fresh && note?.id === fresh) {
			ws.freshNoteId = null;
			tick().then(() => titleInput?.focus());
		}
	});

	function savedMode(): Mode {
		try {
			const m = localStorage.getItem(MODE_KEY);
			if (m === 'write' || m === 'split' || m === 'read') return m;
		} catch {
			/* storage unavailable */
		}
		return 'write';
	}

	function setMode(m: Mode) {
		mode = m;
		try {
			localStorage.setItem(MODE_KEY, m);
		} catch {
			/* storage unavailable */
		}
	}

	function onTitleKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
			e.preventDefault();
			if (shown === 'read') setMode('write');
			tick().then(() => editor?.focus());
		}
	}

	function download() {
		if (!note) return;
		const file = new Blob([noteToMarkdown(note)], { type: 'text/markdown;charset=utf-8' });
		const url = URL.createObjectURL(file);
		const a = Object.assign(document.createElement('a'), { href: url, download: `${safeFileName(note.title)}.md` });
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function confirmDelete() {
		const title = note?.title.trim() || 'Untitled';
		if (confirm(`Delete “${title}” forever? This can’t be undone.`)) ws.deleteForever();
	}
</script>

<section class="note-pane mode-{shown}" aria-label="Note">
	{#if note}
		<header class="toolbar">
			<button class="icon-btn back" onclick={onback} aria-label="Back to notes">
				<ChevronLeft size={20} />
			</button>
			<span class="status" class:error={ws.saveState === 'error'} aria-live="polite">{status}</span>

			<div class="tools">
				{#if note.trashed}
					<button class="btn" onclick={() => ws.restore()}>
						<RotateCcw size={15} />
						Restore
					</button>
					<button class="btn danger" onclick={confirmDelete}>Delete forever</button>
				{:else}
					<div class="modes" role="group" aria-label="Editor layout">
						{#each modes as m (m.id)}
							<button class="opt-{m.id}" aria-pressed={mode === m.id} onclick={() => setMode(m.id)}>
								{m.label}
							</button>
						{/each}
					</div>
					<button
						class="icon-btn"
						aria-pressed={note.pinned}
						aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
						title={note.pinned ? 'Unpin note' : 'Pin note'}
						onclick={() => ws.togglePin()}
					>
						{#if note.pinned}<PinOff size={17} />{:else}<Pin size={17} />{/if}
					</button>
					<button class="icon-btn" aria-label="Download as Markdown" title="Download as Markdown" onclick={download}>
						<Download size={17} />
					</button>
					<button class="icon-btn" aria-label="Move to trash" title="Move to trash" onclick={() => ws.moveToTrash()}>
						<Trash2 size={17} />
					</button>
				{/if}
			</div>
		</header>

		{#if note.trashed}
			<p class="banner">This note is in the trash. Restore it to keep editing.</p>
		{/if}

		<div class="title-row">
			<input
				bind:this={titleInput}
				class="title"
				value={note.title}
				placeholder="Untitled"
				aria-label="Title"
				readonly={note.trashed}
				oninput={(e) => ws.edit({ title: e.currentTarget.value })}
				onkeydown={onTitleKey}
			/>
		</div>

		<div class="meta">
			<label class="notebook" class:unfiled={!note.notebookId}>
				<NotebookIcon size={14} strokeWidth={1.75} />
				<select
					aria-label="Notebook"
					value={note.notebookId ?? ''}
					disabled={note.trashed}
					onchange={(e) => ws.moveToNotebook(e.currentTarget.value || null)}
				>
					<option value="">No notebook</option>
					{#each ws.notebooks as nb (nb.id)}
						<option value={nb.id}>{nb.name}</option>
					{/each}
				</select>
				<span aria-hidden="true">{ws.notebookName(note.notebookId) ?? 'No notebook'}</span>
				<ChevronDown size={13} />
			</label>
			{#each tags as tag (tag)}
				<button class="tag" onclick={() => ws.showTag(tag)} title="Show notes tagged #{tag}">#{tag}</button>
			{/each}
		</div>

		<div class="body">
			{#if !note.trashed}
				<!-- Kept mounted while reading so undo history survives switching layouts. -->
				<div class="write" hidden={shown === 'read'}>
					{#key note.id}
						<Editor bind:this={editor} value={note.content} onchange={(content) => ws.edit({ content })} />
					{/key}
				</div>
			{/if}
			{#if shown !== 'write'}
				<div class="read">
					<Preview source={note.content} ontag={(tag) => ws.showTag(tag)} />
				</div>
			{/if}
		</div>
	{:else}
		<div class="placeholder">
			{#if ws.view === 'trash'}
				<p>Pick a note from the trash to restore it or delete it for good.</p>
			{:else}
				<p>Pick a note, or start a new one.</p>
				<button class="btn primary" onclick={() => ws.create()}>New note</button>
			{/if}
		</div>
	{/if}
</section>

<style>
	.note-pane {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
	}

	.toolbar {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		height: 3.25rem;
		padding: 0 0.75rem 0 1.25rem;
	}
	.back {
		display: none;
		margin-left: -0.5rem;
	}
	.status {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--faint);
		font-size: 0.8125rem;
	}
	.status.error {
		color: var(--danger);
	}
	.tools {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}
	.modes {
		display: inline-flex;
		gap: 2px;
		margin-right: 0.5rem;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.modes button {
		height: 1.65rem;
		padding: 0 0.65rem;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--muted);
		font-size: 0.8125rem;
		font-weight: 500;
	}
	.modes button:hover {
		color: var(--ink);
	}
	.modes button[aria-pressed='true'] {
		background: var(--panel-strong);
		color: var(--ink);
	}

	.banner {
		flex: none;
		margin: 0 1.25rem;
		padding: 0.6rem 0.85rem;
		border-radius: var(--radius);
		background: var(--danger-soft);
		color: var(--danger);
		font-size: 0.875rem;
	}

	.title-row {
		flex: none;
		padding: 1.75rem var(--gutter) 0.75rem;
	}
	.mode-split .title-row {
		padding-inline: 1.5rem;
	}
	.title {
		width: 100%;
		padding: 0;
		border: 0;
		outline: none;
		background: transparent;
		font-family: var(--font-serif);
		font-optical-sizing: auto;
		font-size: clamp(1.85rem, 1.2rem + 1.6vw, 2.6rem);
		font-weight: 480;
		line-height: 1.15;
		letter-spacing: -0.015em;
		text-overflow: ellipsis;
	}
	.title::placeholder {
		color: var(--faint);
	}

	.meta {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		padding: 0 var(--gutter) 1rem;
	}
	.mode-split .meta {
		padding-inline: 1.5rem;
	}
	.notebook {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		height: 1.6rem;
		padding: 0 0.5rem;
		border-radius: 999px;
		background: var(--panel);
		color: var(--ink);
		font-size: 0.8rem;
		font-weight: 500;
	}
	.notebook.unfiled {
		color: var(--muted);
	}
	.notebook:hover {
		background: var(--panel-strong);
	}
	.notebook:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	/* The native select covers the pill so it stays fully keyboard and screen-reader friendly. */
	.notebook select {
		position: absolute;
		inset: 0;
		width: 100%;
		opacity: 0;
		cursor: pointer;
	}
	.notebook select:disabled {
		cursor: default;
	}
	.tag {
		height: 1.6rem;
		padding: 0 0.55rem;
		border: 0;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 0.8rem;
		font-weight: 500;
	}
	.tag:hover {
		background: var(--selection);
	}

	.body {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	.mode-split .body {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	}
	.write {
		min-height: 0;
	}
	.write[hidden] {
		display: none;
	}
	.read {
		min-height: 0;
		overflow-y: auto;
		padding: 0.25rem var(--gutter) 0;
	}
	.mode-split .read {
		padding-inline: 1.5rem;
		border-left: 1px solid var(--line);
	}
	/* The editor pads itself to the same column. */
	.mode-split .write {
		--gutter: 1.5rem;
	}

	.placeholder {
		margin: auto;
		padding: 2rem;
		text-align: center;
		color: var(--muted);
	}
	.placeholder p {
		margin: 0 0 1rem;
		font-family: var(--font-serif);
		font-size: 1.25rem;
		font-style: italic;
	}

	@media (max-width: 760px) {
		.back {
			display: inline-grid;
		}
		.toolbar {
			padding-left: 0.75rem;
		}
		.modes .opt-split {
			display: none;
		}
		.mode-split .body {
			grid-template-columns: minmax(0, 1fr);
		}
		.mode-split .read {
			display: none;
		}
		.mode-split .write {
			--gutter: max(1.25rem, calc((100% - var(--doc-width)) / 2));
		}
		.title-row,
		.mode-split .title-row {
			padding: 1rem 1.25rem 0.5rem;
		}
		.read {
			padding-inline: 1.25rem;
		}
	}
</style>
