<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { Toaster } from '$lib/components/ui/sonner';
	import { theme } from '$lib/theme.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta
		name="description"
		content="Rowbot turns PDFs and images of tables into clean, multi-sheet Excel workbooks you can check before you trust."
	/>
</svelte:head>

<Toaster position="bottom-right" theme={theme.current} richColors closeButton />

{@render children()}
