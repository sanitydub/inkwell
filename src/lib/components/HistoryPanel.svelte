<script lang="ts">
	import { onMount } from 'svelte';
	import { History, X } from '@lucide/svelte';
	import Editor from './Editor.svelte';
	import { api, ApiError } from '#lib/api.ts';
	import { collapseUnchanged, diffLines } from '#lib/diff.ts';
	import { longDate } from '#lib/format.ts';
	import type { NoteVersion, NoteVersionSummary } from '#lib/types.ts';
	import type { Workspace } from '#lib/workspace.svelte.ts';

	interface Props {
		ws: Workspace;
		onclose: () => void;
	}

	let { ws, onclose }: Props = $props();

	let dialog = $state<HTMLDialogElement>();
	let versions = $state<NoteVersionSummary[] | null>(null);
	let selected = $state<NoteVersion | null>(null);
	let loadError = $state<string | null>(null);
	let mode = $state<'changes' | 'full'>('changes');
	let restoring = $state(false);

	const note = $derived(ws.current);
	// The panel closes when another note opens, so the note it was opened for stays fixed.
	let noteId: string | undefined;

	// Compared with the note as it is now: red lines are only in the old version, green only now.
	const chunks = $derived(selected && note ? collapseUnchanged(diffLines(selected.content, note.content)) : []);
	const identical = $derived(!!selected && !!note && selected.content === note.content && selected.title === note.title);

	onMount(() => {
		noteId = ws.current?.id;
		dialog?.showModal();
		load();
	});

	async function load() {
		if (!noteId) return;
		try {
			versions = (await api.listVersions(noteId)).versions;
			if (versions.length) await select(versions[0]);
		} catch (err) {
			loadError = err instanceof ApiError ? err.message : 'Couldn’t load the history. Check your connection and try again.';
		}
	}

	async function select(v: NoteVersionSummary) {
		if (!noteId) return;
		try {
			selected = (await api.getVersion(noteId, v.id)).version;
			loadError = null;
		} catch (err) {
			loadError = err instanceof ApiError ? err.message : 'Couldn’t load that version.';
		}
	}

	async function restore() {
		if (!selected) return;
		if (!confirm(`Restore the version from ${longDate(selected.createdAt)}? The current text is kept in History, so you can undo this.`))
			return;
		restoring = true;
		const ok = await ws.restoreVersion(selected.id);
		restoring = false;
		if (ok) dialog?.close();
	}

	const reasonLabel = (v: NoteVersionSummary) => (v.reason === 'before-restore' ? 'Before a restore' : 'While editing');
	const sizeLabel = (chars: number) => (chars === 1 ? '1 character' : `${chars.toLocaleString()} characters`);
</script>

<dialog bind:this={dialog} class="history" aria-labelledby="history-title" onclose={onclose}>
	<header>
		<History size={18} />
		<h2 id="history-title">History</h2>
		<button class="icon-btn close" aria-label="Close history" onclick={() => dialog?.close()}>
			<X size={18} />
		</button>
	</header>

	{#if versions === null && !loadError}
		<p class="empty">Loading…</p>
	{:else if versions && !versions.length}
		<p class="empty">
			No earlier versions yet. While you edit, Inkwell keeps a version every 10 minutes and before big changes.
		</p>
	{:else}
		<div class="layout">
			<ol class="versions" aria-label="Versions, newest first">
				{#each versions ?? [] as v (v.id)}
					<li>
						<button aria-current={selected?.id === v.id} onclick={() => select(v)}>
							<span class="when">{longDate(v.createdAt)}</span>
							<span class="detail">{reasonLabel(v)} · {sizeLabel(v.size)}</span>
						</button>
					</li>
				{/each}
			</ol>

			<div class="view">
				{#if loadError}
					<p class="error" role="alert">{loadError}</p>
				{/if}
				{#if selected}
					<div class="view-bar">
						<div class="modes" role="group" aria-label="Show">
							<button aria-pressed={mode === 'changes'} onclick={() => (mode = 'changes')}>Changes</button>
							<button aria-pressed={mode === 'full'} onclick={() => (mode = 'full')}>Full version</button>
						</div>
						<button class="btn primary" disabled={restoring || identical} onclick={restore}>
							{restoring ? 'Restoring…' : 'Restore this version'}
						</button>
					</div>

					{#if mode === 'changes'}
						{#if identical}
							<p class="empty">This version is the same as the note now.</p>
						{:else}
							<p class="legend">
								<span class="key del">Only in this version</span>
								<span class="key add">Only in the note now</span>
							</p>
							<div class="diff" role="region" aria-label="Changes since this version">
								{#if note && selected.title !== note.title}
									<div class="line del"><span class="sign">−</span>Title: {selected.title || 'Untitled'}</div>
									<div class="line add"><span class="sign">+</span>Title: {note.title || 'Untitled'}</div>
								{/if}
								{#each chunks as chunk, i (i)}
									{#if chunk.type === 'skip'}
										<div class="skip">{chunk.count === 1 ? '1 unchanged line' : `${chunk.count} unchanged lines`}</div>
									{:else}
										<div class="line {chunk.type}">
											<span class="sign" aria-label={chunk.type === 'add' ? 'Added' : chunk.type === 'del' ? 'Removed' : undefined}
												>{chunk.type === 'add' ? '+' : chunk.type === 'del' ? '−' : ' '}</span
											>{chunk.text || ' '}
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					{:else}
						<div class="full">
							<h3 class:untitled={!selected.title.trim()}>{selected.title.trim() || 'Untitled'}</h3>
							{#key selected.id}
								<Editor value={selected.content} readonly live />
							{/key}
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</dialog>

<style>
	.history {
		display: flex;
		flex-direction: column;
		width: min(68rem, calc(100vw - 2rem));
		height: min(48rem, calc(100dvh - 2rem));
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--paper);
		color: var(--ink);
		box-shadow: 0 20px 60px rgb(0 0 0 / 0.25);
	}
	.history:not([open]) {
		display: none;
	}
	.history::backdrop {
		background: rgb(0 0 0 / 0.35);
	}

	header {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem 0.6rem 1.1rem;
		border-bottom: 1px solid var(--line);
		color: var(--muted);
	}
	h2 {
		margin: 0;
		color: var(--ink);
		font-size: 1rem;
		font-weight: 650;
	}
	.close {
		margin-left: auto;
	}

	.empty {
		margin: 2rem auto;
		max-width: 28rem;
		padding: 0 1rem;
		text-align: center;
		color: var(--muted);
	}

	.layout {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 16rem 1fr;
	}

	.versions {
		margin: 0;
		padding: 0.4rem;
		list-style: none;
		overflow-y: auto;
		border-right: 1px solid var(--line);
		background: var(--panel);
	}
	.versions button {
		display: block;
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		text-align: left;
	}
	.versions button:hover {
		background: var(--panel-strong);
	}
	.versions button[aria-current='true'] {
		background: var(--accent-soft);
		box-shadow: inset 2px 0 0 var(--accent);
	}
	.when {
		display: block;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.detail {
		display: block;
		color: var(--muted);
		font-size: 0.78rem;
	}

	.view {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.view-bar {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--line);
	}
	.modes {
		display: inline-flex;
		padding: 2px;
		border-radius: var(--radius);
		background: var(--panel);
	}
	.modes button {
		height: 1.75rem;
		padding: 0 0.7rem;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--muted);
		font-size: 0.85rem;
		font-weight: 500;
	}
	.modes button[aria-pressed='true'] {
		background: var(--paper);
		color: var(--ink);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
	}

	.error {
		margin: 0.75rem 1rem 0;
		color: var(--danger);
		font-size: 0.875rem;
	}

	.legend {
		flex: none;
		display: flex;
		gap: 1rem;
		margin: 0;
		padding: 0.6rem 1rem 0;
		color: var(--muted);
		font-size: 0.8rem;
	}
	.key::before {
		content: '';
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		margin-right: 0.35rem;
		border-radius: 2px;
		vertical-align: -0.05rem;
	}
	.key.del::before {
		background: var(--diff-del);
	}
	.key.add::before {
		background: var(--diff-add);
	}

	.diff {
		flex: 1;
		min-height: 0;
		overflow: auto;
		margin: 0.6rem 1rem 1rem;
		padding: 0.4rem 0;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		font-family: var(--font-mono);
		font-size: 0.8rem;
		line-height: 1.55;
	}
	.line {
		padding: 0 0.75rem 0 1.6rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.line.add {
		background: var(--diff-add);
	}
	.line.del {
		background: var(--diff-del);
	}
	.sign {
		display: inline-block;
		width: 1.6rem;
		margin-left: -1.6rem;
		text-align: center;
		color: var(--faint);
		user-select: none;
	}
	.skip {
		margin: 0.2rem 0;
		padding: 0.15rem 1.6rem;
		background: var(--panel);
		color: var(--faint);
		font-family: var(--font-ui);
		font-size: 0.75rem;
	}

	.full {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.full h3 {
		flex: none;
		margin: 0;
		padding: 1rem var(--gutter) 0.25rem;
		font-size: 1.4rem;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	.full h3.untitled {
		color: var(--faint);
	}
	.full :global(.cm-editor) {
		flex: 1;
		min-height: 0;
	}

	@media (max-width: 760px) {
		.history {
			width: 100vw;
			max-width: 100vw;
			height: 100dvh;
			max-height: 100dvh;
			border: 0;
			border-radius: 0;
		}
		.layout {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
		}
		.versions {
			display: flex;
			gap: 0.25rem;
			overflow-x: auto;
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}
		.versions button {
			white-space: nowrap;
		}
	}
</style>
