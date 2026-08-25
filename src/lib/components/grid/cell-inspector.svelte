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
	import { Alert01Icon, Note01Icon } from '@hugeicons/core-free-icons';
	import { cellRef, type Sheet } from '$lib/types/workbook';
	import { TYPE_LABEL, formatCell } from '$lib/cell-format';
	import { cn } from '$lib/utils';

	let { sheet, selected }: { sheet: Sheet; selected: { row: number; column: number } | null } =
		$props();

	const cell = $derived(selected ? sheet.rows[selected.row]?.[selected.column] : undefined);
	const columnFormat = $derived(selected ? sheet.columns[selected.column]?.fmt : undefined);
	const label = $derived(selected ? sheet.columns[selected.column]?.label : undefined);
	const shown = $derived(cell ? formatCell(cell, columnFormat) : '');

	/** Only worth showing when coercion changed what the page said. */
	const sourceText = $derived(cell?.raw && cell.raw !== shown ? cell.raw : null);

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
	{#if selected && cell}
		<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
			<span class="font-mono text-[13px] font-semibold tabular-nums">
				{cellRef(selected.row, selected.column)}
			</span>

			<span class="min-w-0 flex-1 truncate text-[13px] text-foreground">{shown || '—'}</span>

			{#if label}
				<span class="max-w-48 truncate text-muted-foreground">{label}</span>
			{/if}

			<span class="text-muted-foreground">{TYPE_LABEL[cell.t]}</span>

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

		{#if cell.note}
			<p class="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-foreground">
				<HugeiconsIcon icon={Note01Icon} size={13} class="mt-0.5 shrink-0 text-primary" />
				<span class="min-w-0">{cell.note}</span>
			</p>
		{/if}
	{:else}
		<p class="text-xs text-muted-foreground">
			Select a cell to see what the page said, how it was typed, and how sure the reader was.
		</p>
	{/if}
</div>
