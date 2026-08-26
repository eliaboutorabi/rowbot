<script lang="ts">
	import { cn } from '$lib/utils';

	/**
	 * The Rowbot mark: a table that reads as a face. Two square cells for
	 * eyes, two data rows below.
	 *
	 * Every element is centred on x=16. The rows taper — 11 units then 6 —
	 * but both are centred rather than left-aligned, so the narrowing reads
	 * as a table closing on a total row instead of a mouth pulling to one
	 * side. An earlier draft started both rows at x=8.5 and the asymmetry
	 * was the first thing anyone noticed.
	 *
	 * Vertical spacing is set from the stroke's inner edge (y=8 to y=27),
	 * not the path, so the padding above the eyes and below the last row
	 * read as equal: 2.5 above, 2.6 below.
	 */
	let {
		class: className,
		/** Off for a mark that should hold still — a favicon, a print header. */
		blink = true,
		...rest
	}: { class?: string; blink?: boolean } = $props();

	let eyes = $state<SVGGElement>();

	/**
	 * The blink, timed per instance rather than per app.
	 *
	 * One period shared by every mark on the page would have them all shut
	 * their eyes together, which is not endearing — it is a strobe. Each gets
	 * its own interval and its own head start, so they drift apart and none of
	 * them looks driven by the same clock.
	 *
	 * Set after mount, not during render: `Math.random()` on the server would
	 * ship one number in the HTML and generate another on hydration, and the
	 * two would disagree.
	 */
	$effect(() => {
		if (!eyes || !blink) return;
		eyes.style.setProperty('--blink-every', `${4.5 + Math.random() * 5}s`);
		eyes.style.setProperty('--blink-offset', `-${Math.random() * 6}s`);
	});
</script>

<svg
	viewBox="0 0 32 32"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	aria-hidden="true"
	class={cn('size-8', className)}
	{...rest}
>
	<!-- antenna -->
	<circle cx="16" cy="2.4" r="1.45" class="fill-accent-ink" />
	<g stroke="currentColor" stroke-width="2" stroke-linecap="round">
		<path d="M16 3.85V7" />
		<!-- head -->
		<rect x="4" y="7" width="24" height="21" rx="6" />
	</g>

	<!-- eyes: true squares, centres at 11 and 21. Grouped so a blink squashes
	     the pair about one shared centre line. -->
	<g bind:this={eyes} class={blink ? 'logo-eyes' : undefined}>
		<rect x="9" y="10.5" width="4" height="4" rx="1.2" class="fill-accent-ink" />
		<rect x="19" y="10.5" width="4" height="4" rx="1.2" class="fill-accent-ink" />
	</g>

	<!-- data rows, both centred on 16 -->
	<g stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity="0.42">
		<path d="M10.5 19h11" />
		<path d="M13 23.2h6" />
	</g>
</svg>
