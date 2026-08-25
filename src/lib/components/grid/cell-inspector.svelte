<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Alert01Icon } from '@hugeicons/core-free-icons';
	import { cellRef, type Sheet } from '$lib/types/workbook';
	import { TYPE_LABEL, formatCell } from '$lib/cell-format';

	let { sheet, selected }: { sheet: Sheet; selected: { row: number; column: number } | null } =
		$props();

	const cell = $derived(selected ? sheet.rows[selected.row]?.[selected.column] : undefined);
	const columnFormat = $derived(selected ? sheet.columns[selected.column]?.fmt : undefined);
	const label = $derived(selected ? sheet.columns[selected.column]?.label : undefined);
	const lowConfidence = $derived(cell?.conf !== undefined && cell.conf < 0.85);
</script>

<div class="flex h-9 shrink-0 items-center gap-3 border-t bg-muted/30 px-3 text-xs">
	{#if selected && cell}
		<span class="w-14 shrink-0 font-mono font-medium">{cellRef(selected.row, selected.column)}</span
		>

		<span class="truncate font-mono">{formatCell(cell, columnFormat) || '—'}</span>

		<span class="ml-auto flex shrink-0 items-center gap-3 text-muted-foreground">
			{#if label}
				<span class="max-w-40 truncate">{label}</span>
			{/if}
			<span>{TYPE_LABEL[cell.t]}</span>
			{#if cell.raw && cell.raw !== formatCell(cell, columnFormat)}
				<span class="max-w-56 truncate" title="What the page actually said">
					source: <span class="font-mono">{cell.raw}</span>
				</span>
			{/if}
			{#if cell.conf !== undefined}
				<span class={lowConfidence ? 'flex items-center gap-1 text-destructive' : ''}>
					{#if lowConfidence}<HugeiconsIcon icon={Alert01Icon} size={12} />{/if}
					{(cell.conf * 100).toFixed(0)}% confident
				</span>
			{/if}
			{#if cell.note}
				<span class="max-w-64 truncate text-foreground">{cell.note}</span>
			{/if}
		</span>
	{:else}
		<span class="text-muted-foreground">Select a cell to see where its value came from.</span>
	{/if}
</div>
