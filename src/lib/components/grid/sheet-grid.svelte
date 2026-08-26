<script lang="ts">
	import { tick } from 'svelte';
	import { cellRef, columnLetter, type Cell, type Sheet } from '$lib/types/workbook';
	import { contains, formatRef, type SheetRef } from '$lib/sheet-ref';
	import { nextCell, spanBetween } from '$lib/grid-keys';
	import { blockSize, selectionToTsv } from '$lib/grid-clipboard';
	import { toast } from 'svelte-sonner';
	import { formatCell, isNumericCell } from '$lib/cell-format';
	import { cn } from '$lib/utils';
	import { confidenceTint } from '$lib/confidence';
	import { isRightToLeft } from '$lib/sheet-direction';
	import { allocateWidths } from '$lib/column-layout';
	import { measureColumns } from '$lib/column-measure';

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

	/*
	 * Everything starts at the same edge.
	 *
	 * Figures used to be right-aligned, which is what a spreadsheet does and
	 * what makes a column of digits comparable at a glance. It stops being
	 * worth it here. Columns are sized to their contents, so a two-character
	 * quantity in a column headed `Qty` sat on the far side of the header
	 * naming it, and a receipt of five short numeric columns came out as five
	 * values scattered against five right edges with their labels stranded at
	 * the left. The reader is checking a transcription against a page, not
	 * scanning a ledger for magnitude, and for that the label and the value
	 * belonging to the same start line beats the digits lining up.
	 *
	 * `tabular-nums` stays. It no longer lines the decimal points up — nothing
	 * does, once numbers of different lengths start at the same edge — but it
	 * keeps every digit the same width, so figures of equal length still agree
	 * down the column and a value does not shift sideways when a 1 is edited
	 * into an 8.
	 */

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
		if (!scroller) return;
		const observer = new ResizeObserver(([entry]) => {
			paneWidth = entry.contentRect.width;
		});
		observer.observe(scroller);
		paneWidth = scroller.clientWidth;
		return () => observer.disconnect();
	});

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

	/**
	 * The tint on a cell, from a continuous ramp rather than three bands.
	 *
	 * Semantic colour, deliberately separate from the brand accent: a
	 * confidence warning must not be mistaken for a highlight. The alpha rises
	 * with doubt so a clean sheet stays quiet — a heat map where every cell
	 * glows spends all its contrast saying nothing is wrong, and the eye has
	 * to find the two doubtful cells inside a wash of colour.
	 *
	 * See `confidence.ts` for why the bands went: the middle one never fired.
	 */
	function confidenceTintOf(cell: Cell): string | undefined {
		if (!heat || cell.conf === undefined) return undefined;
		return confidenceTint(cell.conf);
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
	 * The tooltip a truncated cell needs, worked out on hover.
	 *
	 * Now that columns are fitted to the pane rather than to their widest cell,
	 * a good deal more text is clipped — and clipped text with no way to read it
	 * is worse than a scrollbar. Whether a particular cell is clipped is a
	 * question only the laid-out DOM can answer, so it is asked at the moment
	 * someone hovers, which costs nothing until then and is exact when it
	 * happens.
	 */
	function explain(element: HTMLElement, cell: Cell, column: number) {
		const shown = formatCell(cell, sheet.columns[column]?.fmt);
		const clipped = element.scrollWidth > element.clientWidth + 1;
		const source = cell.raw && cell.raw !== shown ? `The page said: ${cell.raw}` : '';

		const title = [clipped ? shown : '', source].filter(Boolean).join('\n');
		if (title) element.title = title;
		else element.removeAttribute('title');
	}

	const rtl = $derived(isRightToLeft(sheet));

	/* ── Column widths ────────────────────────────────────────────────
	   Sizing every column to its widest cell is Excel's AutoFit, and it is
	   what made a twelve-column transcript need a thousand pixels of sideways
	   scrolling to read a page that had been printed on one sheet of A4.
	   `column-measure` takes a demand from the body of each column's
	   distribution rather than its tail, and `column-layout` allocates those
	   demands across the pane like flex items. Scrolling is then what happens
	   when the columns genuinely will not fit, rather than the default. */

	/** Gutter width in px, matching the `w-*` class chosen above. */
	const gutterWidth = $derived(
		sheet.rows.length > 10000
			? 48
			: sheet.rows.length > 1000
				? 44
				: sheet.rows.length > 100
					? 36
					: 32
	);

	/** The pane's inner width, watched so the layout follows a resize. */
	let paneWidth = $state(0);

	/** Re-measured when the sheet changes; the font is read off the grid itself. */
	const demands = $derived.by(() => {
		void sheet.id;
		void sheet.rows.length;
		if (!scroller) return [];
		const style = getComputedStyle(scroller);
		const font = `${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
		return measureColumns(sheet, { font, headerFont: `600 ${font}` });
	});

	/** A reviewer's own drag beats anything measured. Keyed by column index. */
	let overrides = $state<Record<number, number>>({});

	// Widths belong to the sheet they were drawn on, not to the grid.
	$effect(() => {
		void sheet.id;
		overrides = {};
	});

	const columnWidths = $derived.by(() => {
		if (!demands.length) return sheet.columns.map(() => 120);

		const withOverrides = demands.map((demand, i) =>
			overrides[i] === undefined
				? demand
				: { demand: overrides[i], min: overrides[i], max: overrides[i] }
		);

		const room = Math.max(paneWidth - gutterWidth, 240);
		return allocateWidths(withOverrides, room);
	});

	const tableWidth = $derived(columnWidths.reduce((total, width) => total + width, 0));

	/**
	 * Whether the sheet is wider than the pane after all that.
	 *
	 * When it is, the first column is frozen beside the row numbers. In a
	 * horizontal scroll the leftmost column is what tells you which row you
	 * are looking at, and scrolling it away leaves a wall of figures attached
	 * to nothing — the same reason the header row is frozen vertically.
	 */
	const overflowing = $derived(paneWidth > 0 && tableWidth > paneWidth - gutterWidth + 1);

	/**
	 * Which column rides along with the row numbers, or -1 for none.
	 *
	 * Only worth freezing when there is a sideways scroll to survive, and only
	 * when the column is narrow enough to be a label rather than half the pane.
	 */
	const frozenColumn = $derived(
		overflowing && sheet.columns.length > 2 && (columnWidths[0] ?? 0) <= 220 ? 0 : -1
	);

	/* ── Resizing ─────────────────────────────────────────────────────
	   Drag the edge of a header to set a width, double-click it to fit the
	   contents. An automatic layout that cannot be overruled is an argument
	   with the reviewer, and they are the one looking at the document. */

	let resizing = $state<{ column: number; startX: number; startWidth: number } | null>(null);

	function startResize(event: PointerEvent, column: number) {
		event.preventDefault();
		event.stopPropagation();
		const startWidth = columnWidths[column] ?? 120;
		resizing = { column, startX: event.clientX, startWidth };

		const surface = event.currentTarget as HTMLElement;
		surface.setPointerCapture(event.pointerId);

		const onMove = (move: PointerEvent) => {
			const delta = (move.clientX - event.clientX) * (rtl ? -1 : 1);
			overrides = { ...overrides, [column]: Math.max(48, Math.round(startWidth + delta)) };
		};
		const onUp = () => {
			resizing = null;
			surface.removeEventListener('pointermove', onMove);
			surface.removeEventListener('pointerup', onUp);
			surface.removeEventListener('pointercancel', onUp);
		};

		surface.addEventListener('pointermove', onMove);
		surface.addEventListener('pointerup', onUp);
		surface.addEventListener('pointercancel', onUp);
	}

	/** Double-click: give the column exactly what its widest cell asks for. */
	function autoFit(column: number) {
		const wanted = demands[column];
		if (!wanted) return;
		const { [column]: _dropped, ...rest } = overrides;
		// A second double-click hands the column back to the automatic layout,
		// so the gesture is a toggle rather than a one-way door.
		overrides = overrides[column] === undefined ? { ...rest, [column]: wanted.demand } : rest;
	}

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
	/** What the editor was opened with, to compare against on the way out. */
	let opened = '';

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
		// Kept so a commit can tell a correction from a look. See `commitEdit`.
		opened = draft;
		editing = { row, column };
		selected = { row, column };
		tick().then(() => editor?.select());
	}

	async function commitEdit(next?: { row: number; column: number }) {
		if (!editing || !onedit) return;
		const at = editing;
		const value = draft;
		const held = sheet.rows[at.row]?.[at.column]?.v;
		const unchanged = value === opened;
		editing = null;

		/*
		 * Opening a cell and closing it again is not an edit.
		 *
		 * It used to save anyway, and saving rebuilds the cell from the text in
		 * the box — which loses the reader's confidence, because a figure a
		 * person typed has no OCR confidence to carry. So double-clicking a cell
		 * to read it and pressing Escape's neighbour took the colour off it, and
		 * wrote a revision into the history saying you had edited something you
		 * had not.
		 */
		if (unchanged) {
			if (next) pick(next.row, next.column);
			scroller?.focus({ preventScroll: true });
			return;
		}

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

<!--
	The direction belongs on the scroll container, not only on the table.
	A right-to-left table inside a left-to-right scroller lays its first
	column out at its far right — which is the far end of the scrollable
	content, so the sheet opened showing its *last* columns and column A was
	off-screen. Making the scroller itself right-to-left puts its start edge
	on the right, where the reader already is.
-->
<div
	bind:this={scroller}
	dir={rtl ? 'rtl' : 'ltr'}
	class="scroll-slim h-full overflow-auto"
	role="grid"
	tabindex="0"
	aria-label="Sheet {sheet.name}"
	aria-rowcount={sheet.rows.length}
	aria-colcount={sheet.columns.length}
	aria-activedescendant={selected ? cellId(selected.row, selected.column) : undefined}
	style:--sticky-top="{stickyHeight}px"
	style:--gutter="{gutterWidth}px"
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
	<!-- Direction is inherited from the scroller above, so a Persian table's
	     first column is its rightmost one, as it is on the page. Logical
	     properties below (`start`, `border-e`) then put the frozen row gutter
	     and every vertical rule on the correct side without a second set of
	     rules. -->
	<table
		class="w-full table-fixed border-separate border-spacing-0 text-[13px] leading-5"
		style:min-width="{tableWidth}px"
	>
		<thead bind:this={headEl}>
			<tr>
				<th
					class={cn(
						'sticky start-0 top-0 z-30 border-e border-b border-[var(--grid-line-strong)] bg-[var(--grid-header-bg)]',
						gutter
					)}
					style="border-bottom-width: var(--grid-hairline); border-inline-end-width: var(--grid-hairline)"
					aria-label="Row numbers"
				></th>
				{#each sheet.columns as column, c (c)}
					<th
						class={cn(
							// No `relative` beside `sticky` for the resize grip to hang
							// off: sticky is already a positioned ancestor, and setting
							// both leaves which of them applies down to the order Tailwind
							// happens to emit its utilities in.
							'sticky top-0 border-b border-[var(--grid-line-strong)] p-0',
							// The frozen column's header is sticky in both directions, so
							// it has to sit above the rest of the header row as well as
							// above the body.
							frozenColumn === c ? 'start-(--gutter) z-28' : 'z-20',
							frozenColumn === c && 'shadow-[var(--freeze-edge)]',
							range?.kind === 'column' && inRange(0, c)
								? 'bg-[var(--grid-range)]'
								: 'bg-[var(--grid-header-bg)]'
						)}
						style:border-bottom-width="var(--grid-hairline)"
						style:width="{columnWidths[c]}px"
						title={column.label ?? undefined}
					>
						<!--
							Drag to resize, double-click to fit the contents — the two
							gestures every spreadsheet has, and the pair that makes an
							automatic layout something a reviewer can overrule rather than
							argue with.
						-->
						<div
							class="group/grip absolute inset-y-0 end-0 z-10 w-2 cursor-col-resize"
							role="separator"
							aria-orientation="vertical"
							aria-label="Resize column {columnLetter(c)}"
							title="Drag to resize · double-click to fit the contents"
							onpointerdown={(event) => startResize(event, c)}
							ondblclick={() => autoFit(c)}
						>
							<!-- Inside the cell, not straddling its edge: half of an
							     8px grip hanging past the last column was four pixels of
							     phantom horizontal scroll on a sheet that otherwise fit. -->
							<div
								class="ms-auto h-full w-px bg-primary opacity-0 transition-opacity group-hover/grip:opacity-100"
								class:opacity-100={resizing?.column === c}
							></div>
						</div>
						<!--
							The column's own name, not just its letter. Letters make sense in
							Excel because that is how you address a cell; here every column
							carries a label the model read off the page, and hiding it in a
							tooltip was the most toy-like thing in the grid.
						-->
						<button
							type="button"
							class={cn(
								'flex w-full cursor-pointer items-baseline justify-start gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-colors hover:text-foreground'
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
							'sticky start-0 border-e border-b border-[var(--grid-line)] bg-[var(--grid-header-bg)] px-1.5 text-end align-middle text-[11px] font-normal text-muted-foreground tabular-nums',
							gutter,
							isHeader ? 'z-25' : 'z-10',
							range?.kind === 'row' && inRange(r, 0) && 'bg-[var(--grid-range)] text-accent-ink',
							selected?.row === r && 'font-medium text-accent-ink'
						)}
						style:top={isHeader ? `${stickyTops[r] ?? 0}px` : undefined}
						style:border-bottom-width="var(--grid-hairline)"
						style:border-inline-end-width="var(--grid-hairline)"
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
									'truncate border-e border-b border-e-[var(--grid-line-vertical)] border-b-[var(--grid-line)] px-3 py-1.5 align-middle transition-colors',
									isHeader
										? 'sticky z-15 bg-[var(--grid-header-bg)] font-semibold text-foreground'
										: 'bg-background group-hover:bg-[var(--grid-row-hover)]',
									// Frozen beside the row numbers when the sheet is wider
									// than the pane: in a sideways scroll the first column is
									// what says which row this is, and a wall of figures
									// attached to nothing is no better than no header row.
									frozenColumn === c && 'sticky start-(--gutter) shadow-[var(--freeze-edge)]',
									frozenColumn === c && (isHeader ? 'z-22' : 'z-12 bg-[var(--grid-frozen-bg)]'),
									// Tabular figures keep digits on a shared grid, so decimal
									// points still line up down a left-aligned column; the slight
									// negative tracking stops long currency strings sprawling.
									isNumericCell(cell) && 'tracking-[-0.01em] tabular-nums',

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
								style:border-inline-end-width="var(--grid-hairline)"
								style:scroll-margin-top="var(--sticky-top)"
								style:scroll-margin-inline-start="2.75rem"
								style:background-color={isHeader ? undefined : confidenceTintOf(cell)}
								onmouseenter={(event) => explain(event.currentTarget, cell, c)}
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
