<script lang="ts">
	import './layout.css';
	import { onNavigate } from '$app/navigation';
	import favicon from '$lib/assets/favicon.svg';
	import RouteProgress from '$lib/components/app/route-progress.svelte';
	import { trackScrolling } from '$lib/scrolling';
	import { Toaster } from '$lib/components/ui/sonner';
	import DesktopOnly from '$lib/components/marketing/desktop-only.svelte';
	import { theme } from '$lib/theme.svelte';

	let { children } = $props();

	/**
	 * Below this width Rowbot is not shown at all.
	 *
	 * The product puts a workbook, the page it was read from and the
	 * conversation beside each other; there is no phone width where that holds,
	 * and a cramped version of it would be a version that cannot make its own
	 * case. `767px` rather than a touch-detection heuristic: it is a rule that
	 * fails in the right direction — a desktop window narrowed past it recovers
	 * the moment it is widened, and no laptop is ever wrongly turned away.
	 */
	const NARROW = '(max-width: 767px)';

	// Starts false so the server, which cannot measure a window, renders the app
	// — and so the phone never gets a flash of it, because the CSS below has
	// already hidden it by the time anything is painted.
	let narrow = $state(false);

	$effect(() => {
		const query = window.matchMedia(NARROW);
		const sync = () => (narrow = query.matches);
		sync();
		query.addEventListener('change', sync);
		return () => query.removeEventListener('change', sync);
	});

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

<!--
	Two gates, doing two different jobs. The CSS one hides the app from the
	first paint, so a phone never sees a frame of something it cannot use. The
	`{#if}` unmounts it a moment later, once the client has measured the window,
	so it also stops fetching documents and drawing page thumbnails nobody is
	going to look at.

	`contents` rather than `block`: on a wide screen the wrapper must not exist
	as far as layout is concerned, or it becomes a box between the body and a
	shell that expects to own the whole window.
-->
<div class="hidden md:contents">
	{#if !narrow}
		<RouteProgress />

		<Toaster position="bottom-right" theme={theme.current} richColors closeButton />

		{@render children()}
	{/if}
</div>

<div class="md:hidden">
	<DesktopOnly />
</div>
