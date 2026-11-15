<script lang="ts">
	import { renderMarkdown } from '#lib/markdown.ts';

	interface Props {
		source: string;
		/** Normalized titles of existing notes, so links to missing notes can be shown as such. */
		knownTitles?: ReadonlySet<string>;
		ontag?: (tag: string) => void;
		onlink?: (title: string) => void;
		/** Called with a task's number when its checkbox is clicked. Without it, checkboxes are read-only. */
		ontoggletask?: (index: number) => void;
	}

	let { source, knownTitles, ontag, onlink, ontoggletask }: Props = $props();

	const html = $derived(renderMarkdown(source, knownTitles, { tickableTasks: !!ontoggletask }));

	function onclick(e: MouseEvent) {
		const box = (e.target as Element).closest<HTMLInputElement>('input[data-task]');
		if (box && box.dataset.task) {
			// The note's Markdown changes and the preview re-renders with the new state.
			e.preventDefault();
			ontoggletask?.(Number(box.dataset.task));
			return;
		}
		const button = (e.target as Element).closest<HTMLElement>('button[data-tag], button[data-link]');
		if (button?.dataset.tag) ontag?.(button.dataset.tag);
		else if (button?.dataset.link) onlink?.(button.dataset.link);
	}
</script>

<!-- Clicks on #tag buttons inside the rendered note bubble up to here. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article class="prose" {onclick}>
	{#if source.trim()}
		<!-- Sanitised with DOMPurify in renderMarkdown. -->
		{@html html}
	{:else}
		<p class="empty">Nothing to preview yet.</p>
	{/if}
</article>

<style>
	.prose {
		font-family: var(--font-serif);
		font-size: 1.175rem;
		line-height: 1.65;
		font-optical-sizing: auto;
		max-width: 38rem;
		padding-bottom: 30vh;
		overflow-wrap: break-word;
	}
	.empty {
		color: var(--faint);
		font-style: italic;
	}
	.prose :global(:where(h1, h2, h3, h4, h5, h6)) {
		font-weight: 600;
		line-height: 1.2;
		margin: 1.6em 0 0.5em;
		text-wrap: balance;
	}
	.prose :global(h1) {
		font-size: 1.75em;
	}
	.prose :global(h2) {
		font-size: 1.4em;
	}
	.prose :global(h3) {
		font-size: 1.15em;
	}
	.prose :global(:where(h4, h5, h6)) {
		font-size: 1em;
	}
	.prose > :global(:first-child) {
		margin-top: 0;
	}
	.prose :global(p),
	.prose :global(ul),
	.prose :global(ol),
	.prose :global(blockquote),
	.prose :global(pre),
	.prose :global(table) {
		margin: 0 0 1em;
	}
	.prose :global(:where(ul, ol)) {
		padding-left: 1.4em;
	}
	.prose :global(li + li) {
		margin-top: 0.2em;
	}
	.prose :global(li:has(> input[type='checkbox'])) {
		list-style: none;
		margin-left: -1.4em;
	}
	.prose :global(input[data-task]:not(:disabled)) {
		cursor: pointer;
	}
	.prose :global(li:has(> input[data-task]:checked)),
	.prose :global(li:has(> p > input[data-task]:checked)) {
		color: var(--muted);
	}
	.prose :global(input[type='checkbox']) {
		accent-color: var(--accent);
		margin: 0 0.5em 0 0;
		vertical-align: -0.1em;
	}
	.prose :global(a) {
		color: var(--accent);
		text-decoration-thickness: 1px;
		text-underline-offset: 0.15em;
	}
	.prose :global(blockquote) {
		margin-left: 0;
		padding-left: 1em;
		border-left: 2px solid var(--line);
		color: var(--muted);
		font-style: italic;
	}
	.prose :global(code) {
		font-family: var(--font-mono);
		font-size: 0.8em;
		background: var(--code-bg);
		padding: 0.12em 0.35em;
		border-radius: 4px;
	}
	.prose :global(pre) {
		background: var(--code-bg);
		padding: 0.9em 1.1em;
		border-radius: var(--radius);
		overflow-x: auto;
		line-height: 1.55;
	}
	.prose :global(pre code) {
		background: none;
		padding: 0;
		font-size: 0.78em;
	}
	.prose :global(hr) {
		border: 0;
		border-top: 1px solid var(--line);
		margin: 2em 0;
	}
	.prose :global(img) {
		max-width: 100%;
		border-radius: var(--radius);
	}
	.prose :global(table) {
		border-collapse: collapse;
		font-family: var(--font-ui);
		font-size: 0.8em;
		display: block;
		overflow-x: auto;
	}
	.prose :global(:where(th, td)) {
		border: 1px solid var(--line);
		padding: 0.4em 0.7em;
		text-align: left;
	}
	.prose :global(button.tag) {
		padding: 0 0.15em;
		border: 0;
		border-radius: 3px;
		background: var(--accent-soft);
		color: var(--accent);
		font: inherit;
		font-size: 0.9em;
		cursor: pointer;
	}
	.prose :global(button.tag:hover) {
		background: var(--selection);
	}
	.prose :global(button.wikilink) {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 0.15em;
		cursor: pointer;
	}
	/* A link to a note that doesn't exist yet: clicking it creates the note. */
	.prose :global(button.wikilink.missing) {
		color: var(--muted);
		text-decoration-style: dashed;
	}
	.prose :global(th) {
		background: var(--panel);
		font-weight: 600;
	}
</style>
