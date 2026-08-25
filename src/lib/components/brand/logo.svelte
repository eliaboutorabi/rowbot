<script lang="ts">
	import { cn } from '$lib/utils';

	/**
	 * The Rowbot mark: a table that reads as a face. The top band holds two
	 * square eyes, the bands below are data rows.
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
	<path d="M16 2.5v3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
	<circle cx="16" cy="2.5" r="1.75" class="fill-primary" />

	<!-- head / table body -->
	<rect x="3.5" y="6.5" width="25" height="23" rx="6.5" stroke="currentColor" stroke-width="2" />

	<!-- row divider -->
	<path d="M4 16.5h24" stroke="currentColor" stroke-width="1.5" opacity="0.35" />

	<!-- eyes -->
	<rect x="8.5" y="10.5" width="4.5" height="3.5" rx="1.25" class="fill-primary" />
	<rect x="19" y="10.5" width="4.5" height="3.5" rx="1.25" class="fill-primary" />

	<!-- data rows -->
	<path
		d="M8.5 21h15M8.5 25h9"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		opacity="0.55"
	/>
</svg>
