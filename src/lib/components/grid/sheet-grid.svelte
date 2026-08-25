<script lang="ts">
	import { tick } from 'svelte';
	import { cellRef, columnLetter, type Cell, type Sheet } from '$lib/types/workbook';
	import { contains, formatRef, type SheetRef } from '$lib/sheet-ref';
	import { nextCell, spanBetween } from '$lib/grid-keys';
	import { blockSize, selectionToTsv } from '$lib/grid-clipboard';
	import { toast } from 'svelte-sonner';
	import { formatCell, isNumericCell } from '$lib/cell-format';
	import { cn } from '$lib/utils';

	let {
		sheet,
		heat = false,
		onedit,
		locked,
		selected = $bindable(),
		range = $bindable(null)
	}: {
		sheet: Sheet;
		/** Tint cells by OCR confidence so weak reads are easy to find. */
		heat?: boolean;
		/**
		 * Commit a reviewer's own edit. Absent means the sheet is read-only, so
		 * double-click does nothing rather than opening an editor that cannot
		 * save.
		 */
		onedit?: (edit: {
			row: number;
			column: number;
			value: string;
			/** What the cell held when the editor opened, for the server to check. */
			expect: string;
		}) => Promise<void> | void;
		/**
		 * Why editing is unavailable at this moment, if it is. Editing while the
		 * agent is mid-run would race its writes, and a silent refusal reads as a
		 * broken double-click — so the reason is shown rather than swallowed.
		 */
		locked?: string;
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

	/**
	 * Whole-line selections keep their own anchor.
	 *
	 * Shift-clicking a second gutter number should take everything between the
	 * two, the way it does in a spreadsheet — and that span is a run of rows,
	 * not the rectangle the cell anchor describes. Cleared whenever a plain
	 * click starts somewhere else.
	 */
	let lineAnchor: { kind: 'row' | 'column'; index: number } | null = null;

	function lineRef(kind: 'row' | 'column', a: number, b: number): SheetRef {
		const lo = Math.min(a, b);
		const hi = Math.max(a, b);
		const shape =
			kind === 'row'
				? { kind, from: { row: lo, column: -1 }, to: { row: hi, column: -1 } }
				: { kind, from: { row: -1, column: lo }, to: { row: -1, column: hi } };
		return { sheet: sheet.name, ...shape, raw: formatRef(sheet.name, shape) };
	}

	/** Clicking a gutter number or a column letter takes the whole line. */
	function takeRow(row: number, extend = false) {
		const from = extend && lineAnchor?.kind === 'row' ? lineAnchor.index : row;
		if (!extend || lineAnchor?.kind !== 'row') lineAnchor = { kind: 'row', index: row };
		range = lineRef('row', from, row);
		selected = { row, column: 0 };
		anchor = { row, column: 0 };
	}

	function takeColumn(column: number, extend = false) {
		const from = extend && lineAnchor?.kind === 'column' ? lineAnchor.index : column;
		if (!extend || lineAnchor?.kind !== 'column') lineAnchor = { kind: 'column', index: column };
		range = lineRef('column', from, column);
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
	/**
	 * Reactive, because the effect below measures through it. `bind:this` into a
	 * plain array is a write Svelte cannot see, so the effect ran once against
	 * an empty array and the sticky offsets were measured before the rows it
	 * needed to measure existed.
	 */
	const headerRowEls = $state<HTMLTableRowElement[]>([]);
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

	/**
	 * Bring a cell into view.
	 *
	 * `nearest` is right for a step of one row and wrong for a jump from the
	 * other end of the sheet, which it parks flush against whichever edge it
	 * came from. A jump gets centred instead, so the reviewer arrives looking
	 * at the row and its neighbours rather than at the bottom rule.
	 *
	 * The frozen header sits over the top of the scroller, so a row scrolled
	 * to from below ends up underneath it. The nudge afterwards puts it back.
	 */
	async function reveal(row: number, column: number) {
		// After the state change lands, so the cell exists and is laid out.
		await tick();
		const cell = document.getElementById(cellId(row, column));
		if (!cell || !scroller) return;

		const port = scroller.getBoundingClientRect();
		const box = cell.getBoundingClientRect();
		const ceiling = port.top + stickyHeight;
		const far = box.bottom < ceiling - port.height || box.top > port.bottom + port.height;

		cell.scrollIntoView({ block: far ? 'center' : 'nearest', inline: 'nearest' });

		const landed = cell.getBoundingClientRect();
		if (landed.top < ceiling) scroller.scrollTop -= ceiling - landed.top;
	}

	/**
	 * Every selection is revealed, not just the ones the arrows made.
	 *
	 * Following `[[Ledger!B120]]` out of the conversation switched sheets and
	 * selected the cell without moving the viewport, which left the reviewer
	 * reading row 1 of a 130-row ledger with no sign that anything had
	 * happened. The keyboard already revealed what it moved to; this makes
	 * that true whoever made the selection.
	 */
	$effect(() => {
		const at = selected;
		if (!at || editing) return;
		void sheet.id;
		reveal(at.row, at.column);
	});

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

		// Enter and F2 open the cell under the cursor. Both are deliberate — the
		// thing not offered is typing over a selection, which would make a stray
		// keystroke destructive in a grid whose point is that you can trust it.
		if ((event.key === 'Enter' || event.key === 'F2') && selected && !editing) {
			event.preventDefault();
			beginEdit(selected.row, selected.column);
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
	}

	/* ── Editing ──────────────────────────────────────────────────────
	   A single click selects and a double click edits, which is the division
	   every spreadsheet makes: selecting is what you do constantly and editing
	   is what you mean deliberately. Typing over a selection would make an
	   accidental keystroke destructive in a grid whose whole point is that you
	   can trust the numbers in it. */

	let editing = $state<{ row: number; column: number } | null>(null);
	let draft = $state('');
	let saving = $state(false);
	let editor = $state<HTMLInputElement>();

	function beginEdit(row: number, column: number) {
		if (!onedit || saving) return;
		if (locked) {
			toast.info(locked);
			return;
		}
		const cell = sheet.rows[row]?.[column];
		if (!cell || cell.covered) return;
		// The formula, if there is one — editing a computed cell should show you
		// what computes it, not the number it produced.
		draft = cell.f ? `=${cell.f}` : formatCell(cell, sheet.columns[column]?.fmt);
		editing = { row, column };
		selected = { row, column };
		tick().then(() => editor?.select());
	}

	async function commitEdit(next?: { row: number; column: number }) {
		if (!editing || !onedit) return;
		const at = editing;
		const value = draft;
		const held = sheet.rows[at.row]?.[at.column]?.v;
		editing = null;

		// Move on before the save resolves. Correcting a column means typing,
		// Enter, typing, Enter, and waiting for a round trip between each one
		// would make the grid feel broken.
		if (next) pick(next.row, next.column);
		scroller?.focus({ preventScroll: true });

		saving = true;
		try {
			await onedit({ ...at, value, expect: held == null ? '' : String(held) });
		} finally {
			saving = false;
		}
	}

	/** One step from the cell being edited, clamped, for Enter and Tab. */
	function step(rows: number, columns: number) {
		if (!editing) return undefined;
		return {
			row: Math.min(Math.max(editing.row + rows, 0), lastRow),
			column: Math.min(Math.max(editing.column + columns, 0), lastColumn)
		};
	}

	function onEditorKey(event: KeyboardEvent) {
		// Enter goes down and Tab goes right, as they do in a spreadsheet, so a
		// column of corrections is one uninterrupted run of typing.
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			void commitEdit(step(event.shiftKey ? -1 : 1, 0));
		} else if (event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			void commitEdit(step(0, event.shiftKey ? -1 : 1));
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			editing = null;
			scroller?.focus({ preventScroll: true });
		}
	}

	/** Put the sheet back to nothing selected. */
	export function clearSelection() {
		if (editing) return;
		selected = null;
		range = null;
		anchor = null;
		lineAnchor = null;
	}

	/**
	 * Clicking past the last row, or in the gutter beside the table, means you
	 * are done with the cell you had — the same as clicking away from it. Only
	 * a click that lands on the scroller itself counts; anything on a cell has
	 * already been handled by the time it bubbles here.
	 */
	function onSurfaceClick(event: MouseEvent) {
		if (event.target === event.currentTarget) clearSelection();
	}

	/**
	 * Clicking a cell. With shift held it extends from wherever the selection
	 * started instead of moving it, which is what shift-click means in every
	 * spreadsheet and is the same gesture shift-arrow already performed.
	 */
	function pick(row: number, column: number, extend = false) {
		if (extend && anchor) {
			selected = { row, column };
			range = spanBetween(anchor, { row, column }, sheet.name);
			return;
		}
		selected = { row, column };
		anchor = { row, column };
		lineAnchor = null;
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
	onclick={onSurfaceClick}
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
							onclick={(event) => takeColumn(c, event.shiftKey)}
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
							onclick={(event) => takeRow(r, event.shiftKey)}
							aria-label="Select row {r + 1}"
						>
							{r + 1}
						</button>
					</th>

					{#each row as cell, c (c)}
						{#if !cell.covered}
							<!--
								`dir="auto"` resolves bidi per cell, from the cell's own
								text. A Persian transcript lands in the same grid as an
								English one, and a column of Arabic-script titles laid out
								left-to-right puts every trailing digit, bracket and
								asterisk on the wrong end of the phrase. Numeric cells set
								their alignment explicitly above, so this only moves text.
							-->
							<td
								dir="auto"
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
								onclick={(event) => pick(r, c, event.shiftKey)}
								ondblclick={() => beginEdit(r, c)}
							>
								{#if editing?.row === r && editing?.column === c}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										bind:this={editor}
										bind:value={draft}
										dir="auto"
										autofocus
										class="-my-1.5 w-full bg-transparent px-0 py-1.5 text-inherit outline-none"
										aria-label="Edit {cellRef(r, c)}"
										onkeydown={onEditorKey}
										onblur={() => commitEdit()}
										onclick={(event) => event.stopPropagation()}
									/>
								{:else}
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
