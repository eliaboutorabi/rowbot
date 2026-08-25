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

	/**
	 * Sticky offsets for the sheet's own header rows.
	 *
	 * The column-letter strip pins itself at the top, but a header row lives in
	 * the body and browsers do not stack sticky elements for you — each one
	 * needs the exact height of everything pinned above it. Scrolling a
	 * 130-row ledger used to lose the header entirely, which is precisely when
	 * you need it. Measured rather than assumed, because a wrapped two-line
	 * header is a normal thing for OCR to produce.
	 */
	let headEl = $state<HTMLTableSectionElement>();
	const headerRowEls: HTMLTableRowElement[] = [];
	let stickyTops = $state<number[]>([]);

	function measureHeader() {
		if (!headEl) return;
		let offset = headEl.getBoundingClientRect().height;
		const next: number[] = [];
		for (let i = 0; i < sheet.headerRows; i++) {
			next.push(offset);
			offset += headerRowEls[i]?.getBoundingClientRect().height ?? 0;
		}
		stickyTops = next;
	}

	$effect(() => {
		// Re-measure when the sheet changes shape, and whenever a row resizes.
		void sheet.id;
		void sheet.headerRows;
		measureHeader();

		const observer = new ResizeObserver(measureHeader);
		if (headEl) observer.observe(headEl);
		for (const row of headerRowEls) if (row) observer.observe(row);
		return () => observer.disconnect();
	});

	function confidenceClass(cell: Cell): string {
		if (!heat || cell.conf === undefined) return '';
		// Semantic, and deliberately separate from the brand accent: a confidence
		// warning must not be mistaken for a highlight.
		if (cell.conf >= 0.95) return 'bg-emerald-500/8';
		if (cell.conf >= 0.85) return 'bg-amber-500/14';
		return 'bg-red-500/14';
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
	<!--
		Sans, not mono. A monospaced grid reads as a terminal dump; a spreadsheet
		wants proportional text with tabular figures, so numbers still line up
		in their columns while labels stay legible.
	-->
	<table class="border-separate border-spacing-0 text-[13px] leading-5">
		<thead bind:this={headEl}>
			<tr>
				<th
					class="sticky top-0 left-0 z-30 w-12 border-r border-b border-border/70 bg-muted backdrop-blur-sm"
					aria-label="Row numbers"
				></th>
				{#each sheet.columns as column, c (c)}
					<th
						class="sticky top-0 z-20 min-w-[7.5rem] border-r border-b border-border/70 bg-muted px-3 py-1 text-center text-[10px] font-medium tracking-[0.08em] text-muted-foreground/70 uppercase backdrop-blur-sm"
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
				<tr
					class={cn('group', !isHeader && r % 2 === 1 && '[&>td]:bg-muted/25')}
					bind:this={headerRowEls[r]}
					style={isHeader
						? undefined
						: 'content-visibility: auto; contain-intrinsic-size: auto 30px'}
				>
					<th
						class={cn(
							'sticky left-0 w-12 border-r border-b border-border/70 bg-muted px-1.5 text-right align-middle text-[11px] font-normal text-muted-foreground/70 tabular-nums backdrop-blur-sm',
							isHeader ? 'z-25' : 'z-10',
							selected?.row === r && 'bg-primary/12 font-medium text-primary'
						)}
						style:top={isHeader ? `${stickyTops[r] ?? 0}px` : undefined}
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
									'max-w-[24rem] truncate border-r border-b border-border/45 px-3 py-1.5 align-middle transition-colors',
									isHeader
										? 'sticky z-15 bg-muted font-medium text-foreground'
										: 'bg-background group-hover:bg-accent/40',
									// Tabular figures keep digits on a shared grid; the slight
									// negative tracking stops long currency strings sprawling.
									isNumericCell(cell) && 'text-right tracking-[-0.01em] tabular-nums',
									!isHeader && confidenceClass(cell),
									// Correctness, not confidence — so it does not wait for the
									// heat map to be switched on.
									cell.check?.status === 'mismatch' &&
										'bg-red-500/15 font-semibold text-red-700 ring-1 ring-red-500/40 ring-inset dark:text-red-300',
									selected?.row === r && selected?.column === c && 'ring-2 ring-primary ring-inset'
								)}
								style:top={isHeader ? `${stickyTops[r] ?? 0}px` : undefined}
								title={cell.raw && cell.raw !== formatCell(cell, sheet.columns[c]?.fmt)
									? `Source text: ${cell.raw}`
									: undefined}
								onclick={() => (selected = { row: r, column: c })}
							>
								{formatCell(cell, sheet.columns[c]?.fmt)}
								{#if cell.check?.status === 'mismatch'}
									<span
										class="ml-1 align-super text-[9px] text-red-600 dark:text-red-400"
										aria-label="This total does not reconcile">▲</span
									>
								{/if}
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
