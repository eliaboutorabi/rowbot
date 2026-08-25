<script lang="ts">
	import { columnLetter, type Cell, type Sheet } from '$lib/types/workbook';
	import { formatCell, isNumericCell } from '$lib/cell-format';
	import { cn } from '$lib/utils';

	let {
		sheet,
		heat = false,
		selected = $bindable()
	}: {
		sheet: Sheet;
		/** Tint cells by OCR confidence so weak reads are easy to find. */
		heat?: boolean;
		selected: { row: number; column: number } | null;
	} = $props();

	/** Beyond this the DOM cost stops being worth it; the export has everything. */
	const MAX_ROWS = 4000;
	const visibleRows = $derived(sheet.rows.slice(0, MAX_ROWS));
	const truncated = $derived(sheet.rows.length - visibleRows.length);

	function confidenceClass(cell: Cell): string {
		if (!heat || cell.conf === undefined) return '';
		if (cell.conf >= 0.95) return 'bg-chart-2/8';
		if (cell.conf >= 0.85) return 'bg-amber-400/12';
		return 'bg-destructive/12';
	}

	function move(event: KeyboardEvent) {
		if (!selected) return;
		const keys: Record<string, [number, number]> = {
			ArrowUp: [-1, 0],
			ArrowDown: [1, 0],
			ArrowLeft: [0, -1],
			ArrowRight: [0, 1]
		};
		const delta = keys[event.key];
		if (!delta) return;
		event.preventDefault();
		selected = {
			row: Math.min(Math.max(selected.row + delta[0], 0), visibleRows.length - 1),
			column: Math.min(Math.max(selected.column + delta[1], 0), sheet.columns.length - 1)
		};
	}
</script>

<div
	class="h-full overflow-auto"
	role="grid"
	tabindex="0"
	aria-label="Sheet {sheet.name}"
	aria-rowcount={sheet.rows.length}
	aria-colcount={sheet.columns.length}
	onkeydown={move}
>
	<table class="border-separate border-spacing-0 font-mono text-[13px]">
		<thead>
			<tr>
				<th
					class="sticky top-0 left-0 z-30 w-11 border-r border-b bg-muted/95 backdrop-blur-sm"
					aria-label="Row numbers"
				></th>
				{#each sheet.columns as column, c (c)}
					<th
						class="sticky top-0 z-20 min-w-[7rem] border-r border-b bg-muted/95 px-2.5 py-1 text-left text-[11px] font-medium tracking-wide text-muted-foreground backdrop-blur-sm"
						title={column.label ?? undefined}
					>
						{columnLetter(c)}
					</th>
				{/each}
			</tr>
		</thead>

		<tbody>
			{#each visibleRows as row, r (r)}
				{@const isHeader = r < sheet.headerRows}
				<tr class="group" style="content-visibility: auto; contain-intrinsic-size: auto 30px">
					<th
						class={cn(
							'sticky left-0 z-10 w-11 border-r border-b bg-muted/95 px-1 text-right align-middle text-[11px] font-normal text-muted-foreground backdrop-blur-sm',
							selected?.row === r && 'bg-primary/15 text-primary'
						)}
						scope="row"
					>
						{r + 1}
					</th>

					{#each row as cell, c (c)}
						{#if !cell.covered}
							<td
								rowspan={cell.merge?.rs ?? 1}
								colspan={cell.merge?.cs ?? 1}
								class={cn(
									'max-w-[24rem] truncate border-r border-b px-2.5 py-1 align-middle transition-colors',
									isHeader
										? 'bg-secondary/60 font-semibold text-foreground'
										: 'bg-background hover:bg-accent/50',
									isNumericCell(cell) && 'text-right tabular-nums',
									!isHeader && confidenceClass(cell),
									selected?.row === r && selected?.column === c && 'ring-2 ring-primary ring-inset'
								)}
								title={cell.raw && cell.raw !== formatCell(cell, sheet.columns[c]?.fmt)
									? `Source text: ${cell.raw}`
									: undefined}
								onclick={() => (selected = { row: r, column: c })}
							>
								{formatCell(cell, sheet.columns[c]?.fmt)}
								{#if cell.note}
									<span class="ml-0.5 align-super text-[9px] text-primary" aria-label="Has a note"
										>●</span
									>
								{/if}
							</td>
						{/if}
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	{#if truncated > 0}
		<p class="border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
			Showing the first {MAX_ROWS.toLocaleString()} rows. All {sheet.rows.length.toLocaleString()} are
			in the exported file.
		</p>
	{/if}
</div>
