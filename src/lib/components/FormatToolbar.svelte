<script lang="ts">
	import {
		Bold,
		Code,
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
	import { shortcutLabel, type FormatCommand } from '#lib/editor-format.ts';

	let { onformat }: { onformat: (command: FormatCommand) => void } = $props();

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

<div class="toolbar" role="toolbar" aria-label="Formatting">
	{#each groups as group, g (g)}
		{#if g > 0}<span class="divider" aria-hidden="true"></span>{/if}
		{#each group as item (item.command)}
			<button
				class="icon-btn"
				aria-label={item.label}
				title={tooltip(item.command, item.label)}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => onformat(item.command)}
			>
				<item.icon size={16} strokeWidth={2} />
			</button>
		{/each}
	{/each}
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
	.divider {
		flex: none;
		width: 1px;
		height: 1.1rem;
		margin: 0 0.35rem;
		background: var(--line);
	}
</style>
