<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { X } from '@lucide/svelte';
	import { api } from '#lib/api.ts';
	import { Workspace } from '#lib/workspace.svelte.ts';
	import Sidebar from '#lib/components/Sidebar.svelte';
	import NoteList from '#lib/components/NoteList.svelte';
	import NotePane from '#lib/components/NotePane.svelte';

	let { data } = $props();

	const ws = new Workspace();
	let drawerOpen = $state(false);
	let searchInput = $state<HTMLInputElement>();

	onMount(() => {
		ws.refresh();
		ws.refreshSidebar();
		ws.refreshTitles();
		const id = new URL(location.href).searchParams.get('note');
		if (id) ws.open(id);

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && drawerOpen) drawerOpen = false;
			// The editor handles its own shortcuts (Ctrl+K inserts a link there).
			if (e.defaultPrevented) return;
			if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
			const key = e.key.toLowerCase();
			if (key === 'k') {
				e.preventDefault();
				searchInput?.focus();
				searchInput?.select();
			} else if (key === 's') {
				e.preventDefault();
				ws.flush();
			}
		};
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') ws.flush();
		};
		const onPageHide = () => ws.saveOnExit();

		addEventListener('keydown', onKey);
		addEventListener('pagehide', onPageHide);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			removeEventListener('keydown', onKey);
			removeEventListener('pagehide', onPageHide);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});

	// Keep ?note=<id> in the address bar so reloads and bookmarks reopen the same note.
	let syncedId: string | null | undefined;
	$effect(() => {
		const id = ws.current?.id ?? null;
		if (syncedId === undefined) {
			syncedId = id; // first run happens before the note from the URL has loaded
			return;
		}
		if (id === syncedId) return;
		syncedId = id;
		const url = new URL(location.href);
		if (id) url.searchParams.set('note', id);
		else url.searchParams.delete('note');
		replaceState(url, {});
	});

	async function signOut() {
		await ws.flush();
		await api.logout().catch(() => {});
		location.href = '/login';
	}
</script>

<svelte:head>
	<title>{ws.current ? `${ws.current.title.trim() || 'Untitled'} – Inkwell` : 'Inkwell'}</title>
</svelte:head>

<div class="app" class:has-note={!!ws.current} class:drawer-open={drawerOpen}>
	<div class="col side">
		<Sidebar {ws} user={data.user} onnavigate={() => (drawerOpen = false)} onsignout={signOut} />
	</div>
	<button class="scrim" tabindex="-1" aria-hidden="true" onclick={() => (drawerOpen = false)}></button>
	<div class="col list">
		<NoteList {ws} bind:searchInput onopenmenu={() => (drawerOpen = true)} />
	</div>
	<main class="col main">
		<NotePane {ws} onback={() => ws.close()} />
	</main>
</div>

<div class="toasts">
	{#if ws.renameOffer}
		{@const offer = ws.renameOffer}
		<div class="toast" role="status">
			<span>
				{offer.count === 1 ? '1 note links' : `${offer.count} notes link`} to “{offer.from}”. Point
				{offer.count === 1 ? 'it' : 'them'} at “{offer.to}” instead?
			</span>
			<button class="toast-action" onclick={() => ws.acceptRenameOffer()}>Update links</button>
			<button class="icon-btn" aria-label="Keep the old links" title="Keep the old links" onclick={() => ws.dismissRenameOffer()}>
				<X size={16} />
			</button>
		</div>
	{/if}
	{#if ws.message}
		<div class="toast" role="alert">
			<span>{ws.message}</span>
			<button class="icon-btn" aria-label="Dismiss" onclick={() => (ws.message = null)}><X size={16} /></button>
		</div>
	{/if}
</div>

<style>
	.app {
		display: grid;
		grid-template-columns: 13.5rem 20rem minmax(0, 1fr);
		height: 100dvh;
		overflow: hidden;
	}
	.col {
		min-width: 0;
		min-height: 0;
		height: 100dvh;
	}
	.scrim {
		display: none;
	}

	/* Tablet: the sidebar becomes a drawer. */
	@media (max-width: 1024px) {
		.app {
			grid-template-columns: 19rem minmax(0, 1fr);
		}
		.side {
			position: fixed;
			inset: 0 auto 0 0;
			z-index: 20;
			width: min(16rem, 85vw);
			transform: translateX(-100%);
			visibility: hidden;
			transition:
				transform 0.2s ease,
				visibility 0s linear 0.2s;
		}
		.drawer-open .side {
			transform: none;
			visibility: visible;
			transition: transform 0.2s ease;
			box-shadow: 0 0 0 1px var(--line);
		}
		.drawer-open .scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 10;
			border: 0;
			background: rgb(0 0 0 / 0.3);
		}
	}

	/* Phone: one column at a time, list or note. */
	@media (max-width: 760px) {
		.app {
			grid-template-columns: minmax(0, 1fr);
		}
		.has-note .list,
		.app:not(.has-note) .main {
			display: none;
		}
	}

	/* Messages stack at the bottom centre, newest at the bottom. */
	.toasts {
		position: fixed;
		left: 50%;
		bottom: 1.25rem;
		z-index: 30;
		transform: translateX(-50%);
		display: grid;
		justify-items: center;
		gap: 0.5rem;
		pointer-events: none;
	}
	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: max-content;
		max-width: calc(100vw - 2rem);
		padding: 0.5rem 0.5rem 0.5rem 1rem;
		border-radius: var(--radius);
		background: var(--ink);
		color: var(--paper);
		font-size: 0.875rem;
	}
	.toast .icon-btn {
		color: inherit;
	}
	.toast-action {
		flex: none;
		height: 1.85rem;
		padding: 0 0.7rem;
		border: 0;
		border-radius: 4px;
		background: var(--paper);
		color: var(--ink);
		font-size: 0.8125rem;
		font-weight: 600;
	}
	.toast-action:hover {
		background: var(--panel);
	}
	.toast .icon-btn:hover {
		background: rgb(255 255 255 / 0.12);
	}
</style>
