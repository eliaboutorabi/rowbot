<script lang="ts">
	import { columnLetter, type Cell, type Sheet } from '$lib/types/workbook';
	import { contains, formatRef, type SheetRef } from '$lib/sheet-ref';
	import { formatCell, isNumericCell } from '$lib/cell-format';
	import { cn } from '$lib/utils';

	let {
		sheet,
		heat = false,
		selected = $bindable(),
		range = $bindable(null)
	}: {
		sheet: Sheet;
		/** Tint cells by OCR confidence so weak reads are easy to find. */
		heat?: boolean;
		selected: { row: number; column: number } | null;
		/**
		 * A highlighted region — a whole row or column you clicked, or the place
		 * the agent pointed at. Distinct from `selected`, which is always the one
		 * cell the inspector is describing.
		 */
		range?: SheetRef | null;
	} = $props();

	/** A column reads as numeric when most of its data cells are. */
	function numericColumn(index: number): boolean {
		let numeric = 0;
		let seen = 0;
		for (let r = sheet.headerRows; r < Math.min(sheet.rows.length, sheet.headerRows + 12); r++) {
			const cell = sheet.rows[r]?.[index];
			if (!cell || cell.t === 'blank') continue;
			seen++;
			if (isNumericCell(cell)) numeric++;
		}
		return seen > 0 && numeric / seen >= 0.6;
	}

	const inRange = (row: number, column: number) => Boolean(range && contains(range, row, column));

	/** A four-digit gutter needs room a two-digit one is wasting. */
	const gutter = $derived(
		sheet.rows.length > 10000
			? 'w-12'
			: sheet.rows.length > 1000
				? 'w-11'
				: sheet.rows.length > 100
					? 'w-9'
					: 'w-8'
	);

	/** Clicking a gutter number or a column letter takes the whole line. */
	function takeRow(row: number) {
		range = {
			sheet: sheet.name,
			kind: 'row',
			from: { row, column: -1 },
			to: { row, column: -1 },
			raw: formatRef(sheet.name, {
				kind: 'row',
				from: { row, column: -1 },
				to: { row, column: -1 }
			})
		};
		selected = { row, column: 0 };
	}

	function takeColumn(column: number) {
		range = {
			sheet: sheet.name,
			kind: 'column',
			from: { row: -1, column },
			to: { row: -1, column },
			raw: formatRef(sheet.name, {
				kind: 'column',
				from: { row: -1, column },
				to: { row: -1, column }
			})
		};
		selected = { row: sheet.headerRows, column };
	}

	/** Beyond this the DOM cost stops being worth it; the export has everything. */
	const MAX_ROWS = 4000;

	/**
	 * The real rendered row height: 20px line-height + 12px padding + 1px rule.
	 * `content-visibility` skips offscreen rows and needs a size to reserve; a
	 * wrong guess here compounds into thousands of pixels of scroll error over
	 * a long sheet, which shows up as a thumb that drifts as you scroll.
	 */
	const ROW_HEIGHT = 33;
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
	class="scroll-slim h-full overflow-auto"
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
	<!--
		`table-fixed`: with auto layout the browser measures every row before it
		can resolve a column width, which fights `content-visibility` — whose
		entire purpose is to avoid measuring what is offscreen — and makes the
		columns jump as data streams in.
	-->
	<table class="w-full table-fixed border-separate border-spacing-0 text-[13px] leading-5">
		<thead bind:this={headEl}>
			<tr>
				<th
					class={cn(
						'sticky top-0 left-0 z-30 border-r border-b border-[var(--grid-line-strong)] bg-[var(--grid-header-bg)]',
						gutter
					)}
					style="border-bottom-width: var(--grid-hairline); border-right-width: var(--grid-hairline)"
					aria-label="Row numbers"
				></th>
				{#each sheet.columns as column, c (c)}
					<th
						class={cn(
							'sticky top-0 z-20 border-b border-[var(--grid-line-strong)] p-0',
							range?.kind === 'column' && inRange(0, c)
								? 'bg-[var(--grid-range)]'
								: 'bg-[var(--grid-header-bg)]'
						)}
						style="border-bottom-width: var(--grid-hairline)"
						title={column.label ?? undefined}
					>
						<!--
							The column's own name, not just its letter. Letters make sense in
							Excel because that is how you address a cell; here every column
							carries a label the model read off the page, and hiding it in a
							tooltip was the most toy-like thing in the grid.
						-->
						<button
							type="button"
							class={cn(
								'flex w-full cursor-pointer items-baseline gap-1.5 px-3 py-1.5 text-[13px] font-semibold transition-colors hover:text-foreground',
								numericColumn(c) ? 'justify-end' : 'justify-start'
							)}
							onclick={() => takeColumn(c)}
							aria-label="Select column {columnLetter(c)}"
						>
							{#if column.label}
								<span class="truncate text-foreground/90">{column.label}</span>
								<span class="shrink-0 text-[10px] font-normal text-muted-foreground/50">
									{columnLetter(c)}
								</span>
							{:else}
								<span class="text-muted-foreground/70">{columnLetter(c)}</span>
							{/if}
						</button>
					</th>
				{/each}
			</tr>
		</thead>

		<tbody>
			{#each visibleRows as row, r (r)}
				{@const isHeader = r < sheet.headerRows}
				<tr
					class="group"
					bind:this={headerRowEls[r]}
					style={isHeader
						? undefined
						: `content-visibility: auto; contain-intrinsic-size: auto ${ROW_HEIGHT}px`}
				>
					<th
						class={cn(
							'sticky left-0 border-r border-b border-[var(--grid-line)] bg-[var(--grid-header-bg)] px-1.5 text-right align-middle text-[11px] font-normal text-muted-foreground/60 tabular-nums',
							gutter,
							isHeader ? 'z-25' : 'z-10',
							range?.kind === 'row' && inRange(r, 0) && 'bg-[var(--grid-range)] text-primary',
							selected?.row === r && 'font-medium text-primary'
						)}
						style:top={isHeader ? `${stickyTops[r] ?? 0}px` : undefined}
						style:border-bottom-width="var(--grid-hairline)"
						style:border-right-width="var(--grid-hairline)"
						scope="row"
					>
						<button
							type="button"
							class="w-full cursor-pointer px-0.5 text-right transition-colors hover:text-foreground"
							onclick={() => takeRow(r)}
							aria-label="Select row {r + 1}"
						>
							{r + 1}
						</button>
					</th>

					{#each row as cell, c (c)}
						{#if !cell.covered}
							<td
								rowspan={cell.merge?.rs ?? 1}
								colspan={cell.merge?.cs ?? 1}
								class={cn(
									// Horizontal rules only. Alignment and padding separate the
									// columns; a full lattice is what makes a grid look like a
									// spreadsheet from 1997.
									'truncate border-b border-[var(--grid-line)] px-3 py-1.5 align-middle transition-colors',
									isHeader
										? 'sticky z-15 bg-[var(--grid-header-bg)] font-semibold text-foreground'
										: 'bg-background group-hover:bg-[var(--grid-row-hover)]',
									// Tabular figures keep digits on a shared grid; the slight
									// negative tracking stops long currency strings sprawling.
									isNumericCell(cell) && 'text-right tracking-[-0.01em] tabular-nums',
									!isHeader && confidenceClass(cell),
									// Correctness, not confidence — so it does not wait for the
									// heat map to be switched on.
									inRange(r, c) && 'bg-[var(--grid-range)]',
									cell.check?.status === 'mismatch' &&
										'bg-red-500/15 font-semibold text-red-700 ring-1 ring-red-500/40 ring-inset dark:text-red-300',
									// `outline`, not `ring`: with border-separate a box-shadow
									// ring on a td gets painted over by the next cell's
									// background, and 1px is what every serious grid uses.
									selected?.row === r &&
										selected?.column === c &&
										'outline-1 -outline-offset-1 outline-primary'
								)}
								style:top={isHeader ? `${stickyTops[r] ?? 0}px` : undefined}
								style:border-bottom-width="var(--grid-hairline)"
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
