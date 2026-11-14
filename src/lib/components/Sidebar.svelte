<script lang="ts">
	import { onMount } from 'svelte';
	import { FileText, LogOut, Monitor, Moon, Pin, Sun, Trash2 } from '@lucide/svelte';
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

	<ul class="views">
		{#each views as v (v.id)}
			<li>
				<button
					class="view"
					aria-current={ws.view === v.id ? 'page' : undefined}
					onclick={() => {
						ws.setView(v.id);
						onnavigate?.();
					}}
				>
					<v.icon size={16} strokeWidth={1.75} />
					{v.label}
				</button>
			</li>
		{/each}
	</ul>

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
		padding: 0.75rem 0.6rem;
	}
	.brand {
		margin: 0.35rem 0.6rem 1.4rem;
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.55rem;
		font-weight: 500;
		line-height: 1;
		letter-spacing: -0.01em;
	}
	.views {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.view {
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
	.view:hover {
		background: var(--panel-strong);
		color: var(--ink);
	}
	.view[aria-current='page'] {
		background: var(--panel-strong);
		color: var(--ink);
		font-weight: 600;
	}
	.foot {
		margin-top: auto;
		display: flex;
		align-items: center;
		gap: 0.15rem;
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
