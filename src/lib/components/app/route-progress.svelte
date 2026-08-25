<script lang="ts">
	/**
	 * A thread of progress across the top while a page loads.
	 *
	 * Opening a document is not instant — the server rebuilds the previous
	 * conversation out of its checkpoint before the page can render — and
	 * without this the app looks like it ignored the click. A spinner in the
	 * middle of the screen would be worse: it says "wait", where a bar at the
	 * edge says "working" and leaves the page you are still looking at alone.
	 *
	 * Nothing appears for the first fifth of a second. Most navigations finish
	 * inside that, and a bar that flashes on every click is noise.
	 */
	import { navigating } from '$app/state';
	import { fade } from 'svelte/transition';

	const GRACE_MS = 180;

	let visible = $state(false);

	$effect(() => {
		if (!navigating.to) {
			visible = false;
			return;
		}
		const timer = setTimeout(() => (visible = true), GRACE_MS);
		return () => clearTimeout(timer);
	});
</script>

{#if visible}
	<div
		class="pointer-events-none fixed inset-x-0 top-0 z-100 h-0.5 overflow-hidden"
		role="status"
		aria-label="Loading"
		out:fade={{ duration: 150 }}
	>
		<!--
			Indeterminate on purpose: a server load has no percentage to report,
			and a fake one that sticks at 90% is a lie every user has learned to
			read. A travelling sliver says only "still going", which is true.
		-->
		<div class="sliver h-full w-1/3 rounded-full bg-accent-ink"></div>
	</div>
{/if}

<style>
	.sliver {
		animation: travel 1.1s cubic-bezier(0.65, 0, 0.35, 1) infinite;
	}

	@keyframes travel {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sliver {
			animation: none;
			width: 100%;
			opacity: 0.5;
		}
	}
</style>
