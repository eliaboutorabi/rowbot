<script lang="ts">
	import './layout.css';
	import { onNavigate } from '$app/navigation';
	import favicon from '$lib/assets/favicon.svg';
	import RouteProgress from '$lib/components/app/route-progress.svelte';
	import { trackScrolling } from '$lib/scrolling';
	import { Toaster } from '$lib/components/ui/sonner';
	import { theme } from '$lib/theme.svelte';

	let { children } = $props();

	// Reveals a scroller's bar while it is moving; see `$lib/scrolling`.
	$effect(trackScrolling);

	/**
	 * Cross-fade between pages instead of cutting.
	 *
	 * Opening a project used to replace the whole window in one frame, which is
	 * the same jolt a panel appearing out of nowhere gives — and the rail is
	 * identical on both sides of the navigation, so cutting it away and
	 * redrawing it is a flicker for nothing. The rail is named in the
	 * stylesheet so the browser carries it across untouched, and only the part
	 * that actually changed fades.
	 *
	 * Nothing at all where the API is missing, or where the reader has asked
	 * for less motion — the CSS opts out for them.
	 */
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta
		name="description"
		content="Rowbot turns PDFs and images of tables into clean, multi-sheet Excel workbooks you can check before you trust."
	/>
</svelte:head>

<RouteProgress />

<Toaster position="bottom-right" theme={theme.current} richColors closeButton />

{@render children()}
