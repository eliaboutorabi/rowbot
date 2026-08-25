<script lang="ts">
	/**
	 * An icon that changes when you change it.
	 *
	 * `@hugeicons/svelte`'s own component reads its `icon` prop once, inside
	 * `onMount`, and its update path only forwards size, colour and class — so
	 * an icon swapped for another after the first render never changes. The
	 * theme toggle showed a sun in both themes, the workbook said "Building
	 * your workbook…" beside a warning triangle, and the segmentation control's
	 * eye never closed. Every one of those reads as the app being confused
	 * about its own state.
	 *
	 * Keying on the icon remounts the svg when, and only when, the glyph
	 * actually changes — so a static icon costs nothing and a dynamic one is
	 * correct. Everything in the app goes through here; there is no way to tell
	 * by looking at a call site whether its icon will ever change, and the
	 * cheapest way not to get that wrong is not to have to decide.
	 */
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import type { ComponentProps } from 'svelte';

	// Exactly the props the wrapped component takes, so a call site cannot
	// drift from it and nothing has to be restated here.
	let { icon, ...rest }: ComponentProps<typeof HugeiconsIcon> = $props();
</script>

{#key icon}
	<HugeiconsIcon {icon} {...rest} />
{/key}
