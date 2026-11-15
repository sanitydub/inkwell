<script lang="ts">
	import {
		Ban,
		Bold,
		ChevronDown,
		Code,
		FileCode,
		Heading,
		Highlighter,
		Italic,
		Link,
		List,
		ListOrdered,
		ListTodo,
		Strikethrough,
		Table,
		TextQuote,
		Underline
	} from '@lucide/svelte';
	import { HIGHLIGHT_COLORS, shortcutLabel, type FormatCommand, type HighlightColor } from '#lib/editor-format.ts';
	import { preferences } from '#lib/preferences.svelte.ts';

	interface Props {
		onformat: (command: FormatCommand) => void;
		/** Whether the editor shows plain Markdown instead of the live view. */
		showMarkdown?: boolean;
		ontogglemarkdown?: () => void;
		/** Highlights in a colour, or removes the highlight with null. */
		onhighlight?: (color: HighlightColor | null) => void;
	}

	let { onformat, showMarkdown = false, ontogglemarkdown, onhighlight }: Props = $props();

	const COLOR_NAMES: Record<HighlightColor, string> = {
		yellow: 'Yellow',
		green: 'Green',
		blue: 'Blue',
		pink: 'Pink',
		purple: 'Purple'
	};
	const swatch = (c: HighlightColor) => (c === 'yellow' ? 'var(--mark)' : `var(--hl-${c})`);

	let colorsOpen = $state(false);
	let colorsBox = $state<HTMLElement>();
	// Placed against the window, because the toolbar scrolls sideways on phones and would clip it.
	let colorsAt = $state({ left: 0, top: 0 });

	function toggleColors() {
		if (!colorsOpen && colorsBox) {
			const r = colorsBox.getBoundingClientRect();
			colorsAt = { left: Math.min(r.left, innerWidth - 230), top: r.bottom + 5 };
		}
		colorsOpen = !colorsOpen;
	}

	function pickColor(color: HighlightColor | null) {
		colorsOpen = false;
		if (color) preferences.setHighlightColor(color);
		onhighlight?.(color);
	}

	function closeColors(e: MouseEvent) {
		if (colorsOpen && colorsBox && !colorsBox.contains(e.target as Node)) colorsOpen = false;
	}

	// Groups are separated by a thin divider: text styles, structure, lists, inserts.
	const groups: { command: FormatCommand; label: string; icon: typeof Bold }[][] = [
		[
			{ command: 'bold', label: 'Bold', icon: Bold },
			{ command: 'italic', label: 'Italic', icon: Italic },
			{ command: 'underline', label: 'Underline', icon: Underline },
			{ command: 'strike', label: 'Strikethrough', icon: Strikethrough },
			{ command: 'highlight', label: 'Highlight', icon: Highlighter }
		],
		[
			{ command: 'heading', label: 'Heading (H1, H2, H3, then normal text)', icon: Heading },
			{ command: 'quote', label: 'Quote', icon: TextQuote },
			{ command: 'code', label: 'Code', icon: Code }
		],
		[
			{ command: 'bullet', label: 'Bulleted list', icon: List },
			{ command: 'numbered', label: 'Numbered list', icon: ListOrdered },
			{ command: 'task', label: 'Task list', icon: ListTodo }
		],
		[
			{ command: 'link', label: 'Link', icon: Link },
			{ command: 'table', label: 'Table', icon: Table }
		]
	];

	function tooltip(command: FormatCommand, label: string) {
		const keys = shortcutLabel(command === 'heading' ? 'h1' : command);
		return keys ? `${label} (${command === 'heading' ? keys.replace(/1$/, '1–3') : keys})` : label;
	}
</script>

<svelte:window onclick={closeColors} onkeydown={(e) => e.key === 'Escape' && (colorsOpen = false)} />

<div class="toolbar" role="toolbar" aria-label="Formatting">
	{#each groups as group, g (g)}
		{#if g > 0}<span class="divider" aria-hidden="true"></span>{/if}
		{#each group as item (item.command)}
			{#if item.command === 'highlight' && onhighlight}
				<div class="split" bind:this={colorsBox}>
					<button
						class="icon-btn"
						aria-label="Highlight ({COLOR_NAMES[preferences.highlightColor].toLowerCase()})"
						title={tooltip('highlight', `Highlight in ${COLOR_NAMES[preferences.highlightColor].toLowerCase()}`)}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => onformat('highlight')}
					>
						<item.icon size={16} strokeWidth={2} />
						<span class="color-bar" style:background={swatch(preferences.highlightColor)}></span>
					</button>
					<button
						class="icon-btn more"
						aria-label="Highlight colour"
						title="Highlight colour"
						aria-haspopup="menu"
						aria-expanded={colorsOpen}
						onmousedown={(e) => e.preventDefault()}
						onclick={toggleColors}
					>
						<ChevronDown size={12} strokeWidth={2.25} />
					</button>
					{#if colorsOpen}
						<div
							class="colors"
							role="menu"
							aria-label="Highlight colour"
							style:left="{colorsAt.left}px"
							style:top="{colorsAt.top}px"
						>
							{#each HIGHLIGHT_COLORS as c (c)}
								<button
									role="menuitemradio"
									aria-checked={preferences.highlightColor === c}
									aria-label={COLOR_NAMES[c]}
									title={COLOR_NAMES[c]}
									class="swatch"
									style:background={swatch(c)}
									onmousedown={(e) => e.preventDefault()}
									onclick={() => pickColor(c)}
								></button>
							{/each}
							<button
								role="menuitem"
								class="swatch none"
								aria-label="Remove highlight"
								title="Remove highlight"
								onmousedown={(e) => e.preventDefault()}
								onclick={() => pickColor(null)}
							>
								<Ban size={14} />
							</button>
						</div>
					{/if}
				</div>
			{:else}
				<button
					class="icon-btn"
					aria-label={item.label}
					title={tooltip(item.command, item.label)}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => onformat(item.command)}
				>
					<item.icon size={16} strokeWidth={2} />
				</button>
			{/if}
		{/each}
	{/each}
	{#if ontogglemarkdown}
		<button
			class="icon-btn source"
			aria-pressed={showMarkdown}
			aria-label="Show Markdown"
			title={showMarkdown ? 'Back to the formatted view' : 'Show Markdown'}
			onmousedown={(e) => e.preventDefault()}
			onclick={ontogglemarkdown}
		>
			<FileCode size={16} strokeWidth={2} />
		</button>
	{/if}
</div>

<style>
	/* Wraps onto a second row when space is tight (like Split view); scrolls sideways on phones. */
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1px;
		padding: 0.25rem var(--gutter);
	}
	@media (max-width: 760px) {
		.toolbar {
			flex-wrap: nowrap;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.toolbar::-webkit-scrollbar {
			display: none;
		}
	}
	.icon-btn {
		flex: none;
		width: 1.9rem;
		height: 1.9rem;
	}
	/* The view toggle sits apart from the formatting buttons, at the far end. */
	.source {
		margin-left: auto;
	}
	.source[aria-pressed='true'] {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.split {
		position: relative;
		display: flex;
		align-items: center;
	}
	.split .icon-btn:first-child {
		position: relative;
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.color-bar {
		position: absolute;
		left: 0.5rem;
		right: 0.5rem;
		bottom: 0.25rem;
		height: 3px;
		border-radius: 2px;
	}
	.more {
		width: 1rem;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}
	.more[aria-expanded='true'] {
		background: var(--panel-strong);
		color: var(--ink);
	}
	.colors {
		position: fixed;
		z-index: 30;
		display: flex;
		gap: 0.3rem;
		padding: 0.4rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--paper);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.14);
	}
	.swatch {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		padding: 0;
		border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
		border-radius: 50%;
		color: var(--muted);
	}
	.swatch[aria-checked='true'] {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.swatch.none {
		background: transparent;
	}
	.swatch:hover {
		filter: brightness(0.95);
	}

	.divider {
		flex: none;
		width: 1px;
		height: 1.1rem;
		margin: 0 0.35rem;
		background: var(--line);
	}
</style>
