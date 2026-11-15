<script lang="ts">
	import '@fontsource-variable/instrument-sans';
	import '@fontsource-variable/newsreader/opsz.css';
	import '@fontsource-variable/newsreader/opsz-italic.css';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';
	import '../app.css';
	import Tooltips from '#lib/components/Tooltips.svelte';

	let { children } = $props();
</script>

{@render children()}
<Tooltips />
