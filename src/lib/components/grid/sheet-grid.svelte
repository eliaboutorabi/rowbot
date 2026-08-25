<script lang="ts">
	import { columnLetter, type Cell, type Sheet } from '$lib/types/workbook';
	import { contains, formatRef, type SheetRef } from '$lib/sheet-ref';
	import { nextCell, spanBetween } from '$lib/grid-keys';
	import { blockSize, selectionToTsv } from '$lib/grid-clipboard';
	import { toast } from 'svelte-sonner';
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

	/**
	 * A column reads as numeric when most of its data cells are.
	 *
	 * Computed once per sheet rather than per cell, because the header row and
	 * the column strip both ask. A `Q1` heading has to sit over the right edge
	 * of the figures it labels; aligning it by its own type — text, therefore
	 * left — is what put every quarter's name at the far side of a column of
	 * right-aligned numbers.
	 */
	const numericColumns = $derived.by(() => {
		const flags: boolean[] = [];
		for (let c = 0; c < sheet.columns.length; c++) {
			let numeric = 0;
			let seen = 0;
			for (let r = sheet.headerRows; r < Math.min(sheet.rows.length, sheet.headerRows + 12); r++) {
				const cell = sheet.rows[r]?.[c];
				if (!cell || cell.t === 'blank') continue;
				seen++;
				if (isNumericCell(cell)) numeric++;
			}
			flags[c] = seen > 0 && numeric / seen >= 0.6;
		}
		return flags;
	});

	const numericColumn = (index: number) => numericColumns[index] ?? false;

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
		anchor = { row, column: 0 };
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
		anchor = { row: sheet.headerRows, column };
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

	/** Everything pinned at the top, together — what a cell must clear when
	 *  it is scrolled into view. */
	let stickyHeight = $state(0);

	function measureHeader() {
		if (!headEl) return;
		let offset = headEl.getBoundingClientRect().height;
		const next: number[] = [];
		for (let i = 0; i < sheet.headerRows; i++) {
			next.push(offset);
			offset += headerRowEls[i]?.getBoundingClientRect().height ?? 0;
		}
		stickyTops = next;
		stickyHeight = offset;
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
		//
		// The clean band is barely there on purpose. A heat map where a whole
		// clean sheet glows green spends all its contrast saying "nothing is
		// wrong" — the eye has to find the two amber cells inside a wash of
		// colour instead of on a quiet ground. Enough tint to show the map is
		// on and the cell was measured, and no more.
		if (cell.conf >= 0.95) return 'bg-emerald-500/5';
		if (cell.conf >= 0.85) return 'bg-amber-500/20';
		return 'bg-red-500/22';
	}

	/* ── Keyboard ─────────────────────────────────────────────────────
	   A spreadsheet is a keyboard instrument, and the reviewer's job here is
	   to walk a column of figures and hand the odd one to the agent. So the
	   arrows walk, shift-arrow grows a selection, and the growing selection
	   is a real range — the same object a click on a gutter number produces,
	   and the same one the composer attaches to a message. */

	let scroller = $state<HTMLElement>();

	/** Where a shift-extended selection is anchored. */
	let anchor: { row: number; column: number } | null = null;

	const lastRow = $derived(Math.max(visibleRows.length - 1, 0));
	const lastColumn = $derived(Math.max(sheet.columns.length - 1, 0));

	const cellId = (row: number, column: number) => `${sheet.id}-cell-${row}-${column}`;

	function reveal(row: number, column: number) {
		// After the state change lands, so the cell exists and is laid out.
		requestAnimationFrame(() => {
			document
				.getElementById(cellId(row, column))
				?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		});
	}

	/** How many rows one PageUp/PageDown covers, from the viewport itself. */
	function pageRows(): number {
		const height = (scroller?.clientHeight ?? ROW_HEIGHT * 10) - stickyHeight;
		return Math.max(1, Math.floor(height / ROW_HEIGHT) - 1);
	}

	/**
	 * Cmd-C on a selection.
	 *
	 * The keyboard can now build a block, and the first thing anyone does with
	 * a block in a spreadsheet is copy it. Tab-separated so it pastes into
	 * Excel, Numbers or Sheets as cells rather than as one long string.
	 *
	 * With nothing selected the keystroke is left alone, so a plain Cmd-C still
	 * copies whatever text the reader has highlighted with the mouse.
	 */
	async function copySelection(event: KeyboardEvent) {
		const tsv = selectionToTsv(sheet, range ?? null, selected ?? null);
		if (tsv === null) return;
		event.preventDefault();
		try {
			await navigator.clipboard.writeText(tsv);
			const count = range ? blockSize(sheet, range) : 1;
			toast.success(count === 1 ? 'Copied the cell' : `Copied ${count} cells`);
		} catch {
			// Clipboard access can be refused outright; saying so beats a silent
			// no-op that looks like the shortcut is not wired up.
			toast.error('The browser would not let Rowbot use the clipboard');
		}
	}

	function move(event: KeyboardEvent) {
		const here = selected ?? { row: sheet.headerRows, column: 0 };

		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
			void copySelection(event);
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			range = null;
			anchor = selected;
			return;
		}

		const to = nextCell(
			{ key: event.key, jump: event.metaKey || event.ctrlKey },
			here,
			{ lastRow, lastColumn },
			pageRows()
		);
		if (!to) return;
		event.preventDefault();

		// Shift keeps the anchor and grows the block; a plain move re-anchors.
		if (event.shiftKey) {
			anchor ??= here;
			range = spanBetween(anchor, to, sheet.name);
		} else {
			anchor = to;
			range = null;
		}

		selected = to;
		reveal(to.row, to.column);
	}

	function pick(row: number, column: number) {
		selected = { row, column };
		anchor = { row, column };
		range = null;
	}
</script>

<div
	bind:this={scroller}
	class="scroll-slim h-full overflow-auto"
	role="grid"
	tabindex="0"
	aria-label="Sheet {sheet.name}"
	aria-rowcount={sheet.rows.length}
	aria-colcount={sheet.columns.length}
	aria-activedescendant={selected ? cellId(selected.row, selected.column) : undefined}
	style:--sticky-top="{stickyHeight}px"
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
								'flex w-full cursor-pointer items-baseline gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-colors hover:text-foreground',
								numericColumn(c) ? 'justify-end' : 'justify-start'
							)}
							onclick={() => takeColumn(c)}
							aria-label="Select column {columnLetter(c)}"
						>
							<!--
								When the sheet has its own header row the labels are already
								on screen a few pixels below, so the strip stays an address
								bar and shows only the letter. A sheet with no header row has
								nowhere else to show them, and there the label leads.
							-->
							{#if column.label && sheet.headerRows === 0}
								<span class="truncate text-foreground/90">{column.label}</span>
								<span class="shrink-0 text-[10px] font-normal text-muted-foreground">
									{columnLetter(c)}
								</span>
							{:else}
								<span class="text-muted-foreground">{columnLetter(c)}</span>
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
							'sticky left-0 border-r border-b border-[var(--grid-line)] bg-[var(--grid-header-bg)] px-1.5 text-right align-middle text-[11px] font-normal text-muted-foreground tabular-nums',
							gutter,
							isHeader ? 'z-25' : 'z-10',
							range?.kind === 'row' && inRange(r, 0) && 'bg-[var(--grid-range)] text-accent-ink',
							selected?.row === r && 'font-medium text-accent-ink'
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
									// The vertical rule is roughly half the weight of the
									// horizontal. A lattice of equal lines is what makes a grid
									// look like a spreadsheet from 1997; dropping the verticals
									// entirely loses column separation that a wide sheet needs.
									'truncate border-r border-b border-r-[var(--grid-line-vertical)] border-b-[var(--grid-line)] px-3 py-1.5 align-middle transition-colors',
									isHeader
										? 'sticky z-15 bg-[var(--grid-header-bg)] font-semibold text-foreground'
										: 'bg-background group-hover:bg-[var(--grid-row-hover)]',
									// Tabular figures keep digits on a shared grid; the slight
									// negative tracking stops long currency strings sprawling.
									// A header cell follows its column, not its own type.
									(isHeader ? numericColumn(c) : isNumericCell(cell)) &&
										'text-right tracking-[-0.01em] tabular-nums',
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
								id={cellId(r, c)}
								aria-selected={selected?.row === r && selected?.column === c}
								style:top={isHeader ? `${stickyTops[r] ?? 0}px` : undefined}
								style:border-bottom-width="var(--grid-hairline)"
								style:border-right-width="var(--grid-hairline)"
								style:scroll-margin-top="var(--sticky-top)"
								style:scroll-margin-left="2.75rem"
								title={cell.raw && cell.raw !== formatCell(cell, sheet.columns[c]?.fmt)
									? `Source text: ${cell.raw}`
									: undefined}
								onclick={() => pick(r, c)}
							>
								{formatCell(cell, sheet.columns[c]?.fmt)}
								{#if cell.check?.status === 'mismatch'}
									<span
										class="ml-1 align-super text-[9px] text-red-600 dark:text-red-400"
										aria-label="This total does not reconcile">▲</span
									>
								{/if}
								{#if cell.note}
									<span
										class="ml-0.5 align-super text-[9px] text-accent-ink"
										aria-label="Has a note">●</span
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
