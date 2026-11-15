<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { FileText, Plus, TerminalSquare } from '@lucide/svelte';
	import { keyLabel } from '#lib/editor-format.ts';
	import { fuzzyFilter } from '#lib/fuzzy.ts';
	import { normalizeTitle } from '#lib/links.ts';
	import { preferences, type Theme } from '#lib/preferences.svelte.ts';
	import type { Workspace } from '#lib/workspace.svelte.ts';

	// Ctrl/Cmd+P finds a note by title. Typing ">" first (or opening with Ctrl/Cmd+Shift+P) lists
	// commands instead, the same way VS Code does, so commands work in browsers that keep
	// Ctrl+Shift+P for themselves.

	interface Props {
		ws: Workspace;
		/** Starts in command mode. */
		commands?: boolean;
		onclose: () => void;
		onsearch: () => void;
		onsignout: () => void;
	}

	let { ws, commands: startWithCommands = false, onclose, onsearch, onsignout }: Props = $props();

	interface Command {
		label: string;
		/** CodeMirror-style key, e.g. "Mod-k". */
		key?: string;
		run: () => unknown;
	}

	interface Row {
		id: string;
		label: string;
		/** Matched character positions in the label, to highlight. */
		positions: number[];
		hint?: string;
		kind: 'note' | 'create' | 'command';
		run: () => unknown;
	}

	const MAX_NOTES = 50;

	let dialog = $state<HTMLDialogElement>();
	let input = $state<HTMLInputElement>();
	let list = $state<HTMLElement>();
	let text = $state('');
	let active = $state(0);

	const commandMode = $derived(text.startsWith('>'));
	const query = $derived(commandMode ? text.slice(1).trim() : text.trim());

	function availableCommands(): Command[] {
		const note = ws.current;
		const open = note && !note.trashed;
		const themes: [Theme, string][] = [
			['light', 'Theme: light'],
			['dark', 'Theme: dark'],
			['system', 'Theme: match system']
		];
		return [
			{ label: 'New note', run: () => ws.create() },
			{ label: 'Search notes', key: 'Mod-k', run: onsearch },
			...(open
				? [
						{ label: note.pinned ? 'Unpin note' : 'Pin note', run: () => ws.togglePin() },
						{ label: 'Move note to trash', run: () => ws.moveToTrash() },
						{ label: 'Show note history', run: () => ws.openHistory() },
						{ label: 'Download note as Markdown', run: () => ws.downloadCurrent() },
						{
							label: preferences.showMarkdown ? 'Back to the formatted view' : 'Show Markdown',
							run: () => preferences.toggleShowMarkdown()
						},
						{ label: 'Save now', key: 'Mod-s', run: () => ws.flush() }
					]
				: []),
			...(note?.trashed ? [{ label: 'Restore note from trash', run: () => ws.restore() }] : []),
			{ label: 'Go to All notes', run: () => ws.setView('all') },
			{ label: 'Go to Pinned', run: () => ws.setView('pinned') },
			{ label: 'Go to Trash', run: () => ws.setView('trash') },
			...ws.notebooks.map((nb) => ({ label: `Go to notebook: ${nb.name}`, run: () => ws.showNotebook(nb.id) })),
			...themes
				.filter(([t]) => t !== preferences.theme)
				.map(([t, label]) => ({ label, run: () => preferences.setTheme(t) })),
			{ label: 'Import notes…', run: () => ws.chooseImportFiles() },
			{ label: 'Export all notes', run: () => ws.exportAll() },
			{ label: 'Open Settings', run: async () => (await ws.flush(), goto('/settings')) },
			{ label: 'Sign out', run: onsignout }
		];
	}

	const rows = $derived.by((): Row[] => {
		if (commandMode) {
			return fuzzyFilter(availableCommands(), query, (c) => c.label).map(({ item, match }) => ({
				id: `c:${item.label}`,
				label: item.label,
				positions: match.positions,
				hint: item.key && keyLabel(item.key),
				kind: 'command',
				run: item.run
			}));
		}
		// No query: recently edited notes first (titles come newest first).
		const found = fuzzyFilter(ws.titles, query, (t) => t.title.trim() || 'Untitled').slice(0, MAX_NOTES);
		const out: Row[] = found.map(({ item, match }) => ({
			id: `n:${item.id}`,
			label: item.title.trim() || 'Untitled',
			positions: match.positions,
			hint: item.id === ws.current?.id ? 'Open now' : undefined,
			kind: 'note',
			run: () => ws.open(item.id)
		}));
		if (query && !found.length) {
			out.push({
				id: 'create',
				label: `Create note “${query}”`,
				positions: [],
				kind: 'create',
				run: () => ws.openByTitle(query)
			});
		}
		return out;
	});

	// Back to the top whenever the list changes because of typing.
	$effect(() => {
		text;
		active = 0;
	});

	onMount(() => {
		if (startWithCommands) text = '>';
		dialog?.showModal();
		input?.focus();
	});

	// The dialog's close event arrives a moment after close(). Report closing once, straight away,
	// so the shortcut can open a new palette at once without the late event closing that one too.
	let closed = false;
	function close() {
		dialog?.close();
		reportClosed();
	}
	function reportClosed() {
		if (closed) return;
		closed = true;
		onclose();
	}

	async function choose(row: Row | undefined) {
		if (!row) return;
		close();
		// Let the dialog give focus back before an action moves it somewhere else.
		await tick();
		row.run();
	}

	async function move(by: number) {
		if (!rows.length) return;
		active = (active + by + rows.length) % rows.length;
		await tick();
		list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			move(1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			move(-1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			choose(rows[active]);
		}
	}

	/** Splits a label into plain and highlighted pieces. */
	function pieces(label: string, positions: number[]) {
		const marked = new Set(positions);
		const out: { text: string; hit: boolean }[] = [];
		for (let i = 0; i < label.length; i++) {
			const hit = marked.has(i);
			const last = out[out.length - 1];
			if (last && last.hit === hit) last.text += label[i];
			else out.push({ text: label[i], hit });
		}
		return out;
	}

	const optionId = (i: number) => `palette-option-${i}`;
</script>

<dialog
	bind:this={dialog}
	class="palette"
	aria-label={commandMode ? 'Commands' : 'Open a note'}
	onclose={reportClosed}
	onclick={(e) => e.target === dialog && close()}
>
	<div class="box">
		<input
			bind:this={input}
			bind:value={text}
			class="query"
			type="text"
			role="combobox"
			aria-expanded="true"
			aria-controls="palette-list"
			aria-activedescendant={rows.length ? optionId(active) : undefined}
			aria-autocomplete="list"
			autocomplete="off"
			spellcheck="false"
			placeholder={commandMode ? 'Type a command' : 'Find a note by title, or type > for commands'}
			onkeydown={onKey}
		/>
		<ul bind:this={list} id="palette-list" role="listbox" aria-label={commandMode ? 'Commands' : 'Notes'}>
			{#each rows as row, i (row.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events (the input handles the keyboard) -->
				<li
					id={optionId(i)}
					role="option"
					aria-selected={i === active}
					onmousemove={() => (active = i)}
					onclick={() => choose(row)}
				>
					<span class="icon" aria-hidden="true">
						{#if row.kind === 'note'}<FileText size={15} strokeWidth={1.75} />{:else if row.kind === 'create'}<Plus
								size={15}
								strokeWidth={1.75}
							/>{:else}<TerminalSquare size={15} strokeWidth={1.75} />{/if}
					</span>
					<span class="label" class:untitled={row.kind === 'note' && row.label === 'Untitled'}>
						{#each pieces(row.label, row.positions) as piece, p (p)}{#if piece.hit}<mark>{piece.text}</mark
								>{:else}{piece.text}{/if}{/each}
					</span>
					{#if row.hint}<span class="hint">{row.hint}</span>{/if}
				</li>
			{:else}
				<li class="none" role="presentation">
					{commandMode ? 'No matching commands.' : ws.titles.length ? 'No matching notes.' : 'No notes yet.'}
				</li>
			{/each}
		</ul>
		<p class="help" aria-hidden="true">
			<span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
			<span><kbd>Enter</kbd> to {commandMode ? 'run' : 'open'}</span>
			<span><kbd>Esc</kbd> to close</span>
			{#if !commandMode}<span><kbd>&gt;</kbd> for commands</span>{/if}
		</p>
	</div>
</dialog>

<style>
	.palette {
		width: min(36rem, calc(100vw - 2rem));
		max-height: min(30rem, calc(100dvh - 4rem));
		margin: 12vh auto auto;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--paper);
		color: var(--ink);
		box-shadow: 0 20px 60px rgb(0 0 0 / 0.25);
		overflow: hidden;
	}
	.palette::backdrop {
		background: rgb(0 0 0 / 0.3);
	}
	.box {
		display: flex;
		flex-direction: column;
		max-height: inherit;
	}
	.query {
		flex: none;
		width: 100%;
		padding: 0.85rem 1rem;
		border: 0;
		border-bottom: 1px solid var(--line);
		outline: none;
		background: transparent;
		font-size: 1rem;
	}
	.query::placeholder {
		color: var(--faint);
	}
	ul {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		margin: 0;
		padding: 0.35rem;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius);
		cursor: pointer;
	}
	li[aria-selected='true'] {
		background: var(--accent-soft);
	}
	.icon {
		flex: none;
		display: grid;
		color: var(--faint);
	}
	li[aria-selected='true'] .icon {
		color: var(--accent);
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.9rem;
	}
	.label.untitled {
		color: var(--faint);
		font-style: italic;
	}
	mark {
		background: transparent;
		color: var(--accent);
		font-weight: 650;
	}
	.hint {
		flex: none;
		color: var(--faint);
		font-size: 0.78rem;
	}
	.none {
		justify-content: center;
		padding: 1.25rem;
		color: var(--muted);
		cursor: default;
	}
	.help {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		margin: 0;
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--line);
		color: var(--faint);
		font-size: 0.75rem;
	}
	kbd {
		display: inline-block;
		min-width: 1.2rem;
		margin-right: 0.2rem;
		padding: 0 0.25rem;
		border: 1px solid var(--line);
		border-radius: 3px;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		text-align: center;
	}
</style>
