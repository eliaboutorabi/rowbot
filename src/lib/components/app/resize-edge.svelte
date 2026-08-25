<script lang="ts">
	/**
	 * The draggable edge of a side column.
	 *
	 * Sits in the column's own last two pixels rather than straddling its
	 * border, so it can never add width the column did not ask for. Invisible
	 * until you are near it, because a permanent line down the middle of the
	 * app is a seam; under the cursor it is the accent colour, which is the
	 * only thing that needs saying.
	 *
	 * Double-click puts the column back to its default, the same gesture that
	 * resets a spreadsheet column, and the keyboard can walk it with the arrows
	 * — a drag handle nobody can reach is not a control.
	 */
	import { widths, type Column } from '$lib/stores/layout.svelte';
	import { cn } from '$lib/utils';

	let {
		column,
		/** `1` when the column grows to the right, `-1` when it grows to the left. */
		direction = 1,
		ondragging
	}: { column: Column; direction?: 1 | -1; ondragging?: (active: boolean) => void } = $props();

	let dragging = $state(false);

	const limits = $derived(widths.limits(column));

	function start(event: PointerEvent) {
		event.preventDefault();
		const surface = event.currentTarget as HTMLElement;
		const startX = event.clientX;
		const startWidth = widths[column];

		dragging = true;
		ondragging?.(true);
		surface.setPointerCapture(event.pointerId);

		const move = (next: PointerEvent) =>
			widths.set(column, startWidth + (next.clientX - startX) * direction);

		const stop = () => {
			dragging = false;
			ondragging?.(false);
			surface.removeEventListener('pointermove', move);
			surface.removeEventListener('pointerup', stop);
			surface.removeEventListener('pointercancel', stop);
		};

		surface.addEventListener('pointermove', move);
		surface.addEventListener('pointerup', stop);
		surface.addEventListener('pointercancel', stop);
	}

	function onKey(event: KeyboardEvent) {
		const step = event.shiftKey ? 48 : 12;
		if (event.key === 'ArrowLeft') widths.set(column, widths[column] - step * direction);
		else if (event.key === 'ArrowRight') widths.set(column, widths[column] + step * direction);
		else return;
		event.preventDefault();
	}
</script>

<!--
	A focusable `separator` with a value is the ARIA window-splitter pattern
	exactly; the linter only knows that separators are usually decorative.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="group/edge absolute inset-y-0 end-0 z-30 w-1.5 cursor-col-resize touch-none"
	role="separator"
	aria-orientation="vertical"
	aria-label="Resize this column"
	aria-valuenow={widths[column]}
	aria-valuemin={limits.min}
	aria-valuemax={limits.max}
	tabindex="0"
	title="Drag to resize · double-click to reset"
	onpointerdown={start}
	ondblclick={() => widths.set(column, limits.fallback)}
	onkeydown={onKey}
>
	<div
		class={cn(
			'ms-auto h-full w-0.5 bg-accent-ink transition-opacity duration-150',
			dragging
				? 'opacity-100'
				: 'opacity-0 group-hover/edge:opacity-70 group-focus/edge:opacity-100'
		)}
	></div>
</div>
