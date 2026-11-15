<script lang="ts">
	import { onMount, tick } from 'svelte';

	// Quick tooltips for every element with a title attribute. Browsers wait about a second before
	// showing a title; this shows it after SHOW_DELAY instead, and at once when moving between
	// buttons while one is already showing. The title is set aside while the pointer is over the
	// element, so the browser's own tooltip doesn't appear as well, and put back when it leaves.

	const SHOW_DELAY = 300;
	/** Moving to another button within this long after a tooltip hid shows the next one at once. */
	const WARM_FOR = 400;
	const GAP = 6;

	let text = $state('');
	let x = $state(0);
	let y = $state(0);
	let placement = $state<'below' | 'above'>('below');
	let visible = $state(false);
	let box = $state<HTMLElement>();

	let target: HTMLElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let hiddenAt = 0;

	function release() {
		clearTimeout(timer);
		if (target?.dataset.tip !== undefined) {
			// Put the title back unless the app changed it meanwhile.
			if (!target.hasAttribute('title')) target.setAttribute('title', target.dataset.tip);
			delete target.dataset.tip;
		}
		target = null;
		if (visible) hiddenAt = Date.now();
		visible = false;
	}

	async function show() {
		if (!target || !target.isConnected) return release();
		text = target.dataset.tip ?? '';
		if (!text) return;
		visible = true;
		await tick();
		if (!target || !box) return;
		// A manual popover sits in the top layer, so it also shows over open dialogs.
		try {
			box.showPopover();
		} catch {
			/* older browsers: the fixed position still works outside dialogs */
		}
		const r = target.getBoundingClientRect();
		const w = box.offsetWidth;
		const h = box.offsetHeight;
		placement = r.bottom + GAP + h > innerHeight - 4 ? 'above' : 'below';
		y = placement === 'below' ? r.bottom + GAP : r.top - GAP - h;
		x = Math.min(Math.max(4, r.left + r.width / 2 - w / 2), innerWidth - w - 4);
	}

	function begin(el: HTMLElement) {
		if (el === target) return;
		release();
		const title = el.getAttribute('title');
		if (!title) return;
		target = el;
		el.dataset.tip = title;
		el.removeAttribute('title');
		// Keep the label for screen readers, which read the title when there's no other name.
		if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title);
		const warm = Date.now() - hiddenAt < WARM_FOR;
		timer = setTimeout(show, warm ? 0 : SHOW_DELAY);
	}

	onMount(() => {
		const over = (e: PointerEvent) => {
			if (e.pointerType === 'touch') return;
			const el = (e.target as Element).closest<HTMLElement>('[title], [data-tip]');
			if (el) begin(el);
			else if (target) release();
		};
		const out = (e: PointerEvent) => {
			if (target && !target.contains(e.relatedTarget as Node)) release();
		};
		// Keyboard users get the tooltip for the focused control too.
		const focus = (e: FocusEvent) => {
			const el = e.target as HTMLElement;
			if (el.matches?.(':focus-visible') && el.hasAttribute('title')) begin(el);
		};
		const blur = () => target && release();
		const away = () => target && release();

		document.addEventListener('pointerover', over);
		document.addEventListener('pointerout', out);
		document.addEventListener('focusin', focus);
		document.addEventListener('focusout', blur);
		document.addEventListener('pointerdown', away, true);
		document.addEventListener('keydown', away, true);
		addEventListener('scroll', away, true);
		return () => {
			release();
			document.removeEventListener('pointerover', over);
			document.removeEventListener('pointerout', out);
			document.removeEventListener('focusin', focus);
			document.removeEventListener('focusout', blur);
			document.removeEventListener('pointerdown', away, true);
			document.removeEventListener('keydown', away, true);
			removeEventListener('scroll', away, true);
		};
	});
</script>

{#if visible}
	<div bind:this={box} popover="manual" class="tooltip {placement}" role="tooltip" style:left="{x}px" style:top="{y}px">{text}</div>
{/if}

<style>
	.tooltip {
		position: fixed;
		inset: auto;
		margin: 0;
		border: 0;
		z-index: 1000;
		max-width: min(22rem, calc(100vw - 8px));
		padding: 0.3rem 0.55rem;
		border-radius: 5px;
		background: var(--ink);
		color: var(--paper);
		font-size: 0.78rem;
		font-weight: 500;
		line-height: 1.35;
		pointer-events: none;
		overflow-wrap: anywhere;
		animation: tip-in 80ms ease-out;
	}
	@keyframes tip-in {
		from {
			opacity: 0;
		}
	}
</style>
