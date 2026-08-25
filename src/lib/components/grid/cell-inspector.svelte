<script lang="ts">
	/**
	 * Where a cell's value came from.
	 *
	 * This is the answer to "can I trust this number", so it earns room. The
	 * previous version crammed the reference, value, type, source text, note and
	 * confidence onto one 36px line, where the note — the one field written for
	 * a human — was truncated at 16rem and unreadable.
	 */
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Alert01Icon, Note01Icon, PlusSignIcon, ViewIcon } from '@hugeicons/core-free-icons';
	import { cellRef, type Sheet } from '$lib/types/workbook';
	import { TYPE_LABEL, formatCell } from '$lib/cell-format';
	import { cn } from '$lib/utils';
	import { contains, refLabel, type SheetRef } from '$lib/sheet-ref';

	let {
		sheet,
		selected,
		range = null,
		onshowsource,
		onattach
	}: {
		sheet: Sheet;
		selected: { row: number; column: number } | null;
		/** A highlighted row or column, when one is taken. */
		range?: SheetRef | null;
		/** Jump to the region of the page this sheet was read from. */
		onshowsource?: () => void;
		/** Hand the current selection to the composer. */
		onattach?: () => void;
	} = $props();

	const cell = $derived(selected ? sheet.rows[selected.row]?.[selected.column] : undefined);
	const columnFormat = $derived(selected ? sheet.columns[selected.column]?.fmt : undefined);
	const label = $derived(selected ? sheet.columns[selected.column]?.label : undefined);
	const shown = $derived(cell ? formatCell(cell, columnFormat) : '');

	/** Only worth showing when coercion changed what the page said. */
	const sourceText = $derived(cell?.raw && cell.raw !== shown ? cell.raw : null);

	/**
	 * What a spreadsheet's status bar tells you about a selection, because it
	 * is the fastest way to check a printed total: select the column above it
	 * and read the sum. Header rows are left out — a year in a header is not
	 * part of the column's arithmetic.
	 */
	const tally = $derived.by(() => {
		if (!range) return null;
		let cells = 0;
		let numeric = 0;
		let sum = 0;
		for (let r = sheet.headerRows; r < sheet.rows.length; r++) {
			const row = sheet.rows[r];
			if (!row) continue;
			for (let c = 0; c < row.length; c++) {
				if (!contains(range, r, c)) continue;
				const value = row[c];
				if (!value || value.covered) continue;
				cells++;
				if (typeof value.v === 'number' && Number.isFinite(value.v)) {
					numeric++;
					sum += value.v;
				}
			}
		}
		return { cells, numeric, sum: Number(sum.toFixed(10)) };
	});

	const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

	const shape = $derived(
		range?.kind === 'row'
			? 'Whole row'
			: range?.kind === 'column'
				? 'Whole column'
				: `${(range?.to.row ?? 0) - (range?.from.row ?? 0) + 1} × ${(range?.to.column ?? 0) - (range?.from.column ?? 0) + 1} block`
	);

	/** The modifier this reader actually presses. */
	const copyKey =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
			? '\u2318C'
			: 'Ctrl+C';

	const confidence = $derived(cell?.conf);
	const band = $derived(
		confidence === undefined
			? null
			: confidence >= 0.95
				? { tone: 'text-emerald-600 dark:text-emerald-400', word: 'read cleanly' }
				: confidence >= 0.85
					? { tone: 'text-amber-600 dark:text-amber-400', word: 'slightly unsure' }
					: { tone: 'text-destructive', word: 'worth checking' }
	);
</script>

<div class="shrink-0 border-t bg-muted/25 px-3 py-2">
	{#if range}
		<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
			<span class="font-mono text-[13px] font-semibold">{refLabel(range)}</span>
			<span class="shrink-0 text-muted-foreground">{shape}</span>

			{#if tally}
				<span class="min-w-0 flex-1 truncate text-muted-foreground tabular-nums">
					{tally.cells}
					{tally.cells === 1 ? 'cell' : 'cells'}
					{#if tally.numeric > 0}
						· sum <span class="text-foreground">{number.format(tally.sum)}</span>
						· avg {number.format(tally.sum / tally.numeric)}
					{/if}
				</span>
			{:else}
				<span class="min-w-0 flex-1"></span>
			{/if}
			{#if onattach}
				<button
					type="button"
					class="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-medium text-accent-ink transition-colors hover:bg-primary/20"
					onclick={onattach}
				>
					<HugeiconsIcon icon={PlusSignIcon} size={12} />
					Add to chat
				</button>
			{/if}
		</div>
	{:else if selected && cell}
		<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
			<span class="font-mono text-[13px] font-semibold tabular-nums">
				{cellRef(selected.row, selected.column)}
			</span>

			<span class="min-w-0 flex-1 truncate text-[13px] text-foreground">{shown || '—'}</span>

			{#if label}
				<span class="max-w-48 truncate text-muted-foreground">{label}</span>
			{/if}

			<span class="text-muted-foreground">{TYPE_LABEL[cell.t]}</span>

			{#if onattach}
				<button
					type="button"
					class="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-medium text-accent-ink transition-colors hover:bg-primary/20"
					onclick={onattach}
				>
					<HugeiconsIcon icon={PlusSignIcon} size={12} />
					Add to chat
				</button>
			{/if}

			{#if onshowsource && sheet.source?.tablePath}
				<button
					type="button"
					class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-accent-ink transition-colors hover:bg-primary/10"
					onclick={onshowsource}
				>
					<HugeiconsIcon icon={ViewIcon} size={13} />
					Show on page{sheet.source.pageIndex !== undefined ? ` ${sheet.source.pageIndex + 1}` : ''}
				</button>
			{/if}

			{#if confidence !== undefined && band}
				<span
					class={cn('flex shrink-0 items-center gap-1 tabular-nums', band.tone)}
					title="The lowest word-level OCR confidence in this cell"
				>
					{#if confidence < 0.85}
						<HugeiconsIcon icon={Alert01Icon} size={12} />
					{/if}
					{(confidence * 100).toFixed(1)}% · {band.word}
				</span>
			{/if}
		</div>

		{#if sourceText}
			<p class="mt-1 truncate text-xs text-muted-foreground">
				The page said
				<span class="font-mono text-foreground/80">{sourceText}</span>
				— Rowbot read it as {TYPE_LABEL[cell.t].toLowerCase()}.
			</p>
		{/if}

		{#if cell.check?.status === 'mismatch'}
			<p
				class="mt-1.5 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs leading-relaxed text-destructive"
			>
				<HugeiconsIcon icon={Alert01Icon} size={13} class="mt-0.5 shrink-0" />
				<span class="min-w-0">
					{cell.check.message}
					<span class="text-destructive/80">
						This cell keeps what the document printed; nothing has been changed for you.
					</span>
					{#if sheet.source?.tablePath && onshowsource}
						<button type="button" class="ml-1 underline underline-offset-2" onclick={onshowsource}>
							Check the page
						</button>
					{/if}
				</span>
			</p>
		{:else if cell.check?.status === 'ok' && cell.f}
			<p class="mt-1 text-xs text-muted-foreground">
				<span class="font-mono text-foreground/80">={cell.f}</span> — {cell.check.message}
			</p>
		{/if}

		{#if cell.note}
			<p class="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-foreground">
				<HugeiconsIcon icon={Note01Icon} size={13} class="mt-0.5 shrink-0 text-accent-ink" />
				<span class="min-w-0">{cell.note}</span>
			</p>
		{/if}
	{:else}
		<!--
			Two facts on one line, not a wrapped paragraph. This strip sits between
			the sheet and its tabs, and a second line of placeholder text pushes
			the tabs down every time nothing is selected — which is most of the
			time. The keyboard hint is the half that goes when there is no room.
		-->
		<p class="flex items-baseline gap-x-4 text-xs text-muted-foreground">
			<span class="min-w-0 truncate">
				Select a cell to see what the page said, how it was typed, and how sure the reader was.
			</span>
			<span class="hidden shrink-0 lg:inline">
				Arrows move · shift takes a block · {copyKey} copies it
			</span>
		</p>
	{/if}
</div>
