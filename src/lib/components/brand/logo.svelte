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
	let { class: className, ...rest }: { class?: string } = $props();
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
	<circle cx="16" cy="2.4" r="1.45" class="fill-primary" />
	<g stroke="currentColor" stroke-width="2" stroke-linecap="round">
		<path d="M16 3.85V7" />
		<!-- head -->
		<rect x="4" y="7" width="24" height="21" rx="6" />
	</g>

	<!-- eyes: true squares, centres at 11 and 21 -->
	<rect x="9" y="10.5" width="4" height="4" rx="1.2" class="fill-primary" />
	<rect x="19" y="10.5" width="4" height="4" rx="1.2" class="fill-primary" />

	<!-- data rows, both centred on 16 -->
	<g stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity="0.42">
		<path d="M10.5 19h11" />
		<path d="M13 23.2h6" />
	</g>
</svg>
