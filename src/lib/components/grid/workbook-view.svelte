<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Download04Icon,
		FileSpreadsheetIcon,
		File01Icon,
		Note01Icon,
		ThermometerIcon
	} from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import SheetGrid from './sheet-grid.svelte';
	import CellInspector from './cell-inspector.svelte';
	import SourceView from '$lib/components/source/source-view.svelte';
	import { cn } from '$lib/utils';
	import type { WorkbookModel } from '$lib/types/workbook';

	let {
		workbook,
		documentId,
		mimeType,
		busy = false
	}: {
		workbook: WorkbookModel | null;
		documentId: string;
		mimeType: string;
		busy?: boolean;
	} = $props();

	type View = 'workbook' | 'source';
	let view = $state<View>('workbook');

	let activeId = $state<string | null>(null);
	let heat = $state(false);
	let selected = $state<{ row: number; column: number } | null>(null);

	/**
	 * Crossing from a block on the page to the sheet it became. Both sides
	 * name the table by the same workspace path, so this is a lookup rather
	 * than a guess.
	 */
	function openTable(path: string) {
		const match = sheets.find((sheet) => sheet.source?.tablePath === path);
		if (!match) return;
		activeId = match.id;
		selected = null;
		view = 'workbook';
	}

	const sheets = $derived(workbook?.sheets ?? []);
	const active = $derived(sheets.find((s) => s.id === activeId) ?? sheets[0]);

	// Follow the agent to whatever sheet it just created.
	$effect(() => {
		const latest = sheets.at(-1);
		if (latest && !sheets.some((s) => s.id === activeId)) {
			activeId = latest.id;
			selected = null;
		}
	});

	/** Paths of OCR tables that made it into the workbook, for the overlay. */
	const linkedPaths = $derived(
		sheets.map((sheet) => sheet.source?.tablePath).filter((path): path is string => Boolean(path))
	);

	const lowConfidenceCount = $derived(
		active?.rows.reduce(
			(total, row) => total + row.filter((c) => c.conf !== undefined && c.conf < 0.85).length,
			0
		) ?? 0
	);
</script>

<div class="flex h-full min-w-0 flex-col bg-background">
	<!-- ── View switcher ───────────────────────────────────────────────
	     The workbook and the page it came from are two readings of the same
	     document, so they are peers here rather than one being buried behind
	     a button on the other. -->
	<div class="flex h-11 shrink-0 items-center gap-2 border-b px-3">
		<div class="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
			{#each [{ id: 'workbook', label: 'Workbook', icon: FileSpreadsheetIcon }, { id: 'source', label: 'Source', icon: File01Icon }] as const as tab (tab.id)}
				<button
					type="button"
					class={cn(
						'flex items-center gap-1.5 rounded-[0.4rem] px-2.5 py-1 text-[0.8125rem] font-medium transition-colors',
						view === tab.id
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					)}
					aria-pressed={view === tab.id}
					onclick={() => (view = tab.id)}
				>
					<HugeiconsIcon icon={tab.icon} size={14} />
					{tab.label}
				</button>
			{/each}
		</div>

		{#if view === 'workbook' && workbook?.title}
			<span class="min-w-0 truncate text-sm font-medium">{workbook.title}</span>
		{/if}

		{#if view === 'workbook' && sheets.length}
			<span class="ml-auto flex items-center gap-1.5">
				{#if workbook?.notes}
					<Popover.Root>
						<Popover.Trigger>
							{#snippet child({ props })}
								<Button {...props} variant="ghost" size="sm" class="gap-1.5 text-muted-foreground">
									<HugeiconsIcon icon={Note01Icon} size={14} />
									Notes
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-96 text-sm leading-relaxed" align="end">
							<p class="font-medium">What Rowbot wants you to check</p>
							<p class="mt-0.5 mb-2.5 text-xs text-muted-foreground">
								Written by the agent while it built this workbook — the judgement calls it made and
								anything it could not resolve from the page.
							</p>
							<p class="whitespace-pre-wrap text-muted-foreground">{workbook.notes}</p>
						</Popover.Content>
					</Popover.Root>
				{/if}

				<Button
					variant={heat ? 'secondary' : 'ghost'}
					size="sm"
					class="gap-1.5"
					onclick={() => (heat = !heat)}
					title="Tint cells by how confident the reader was, lowest word first"
				>
					<HugeiconsIcon icon={ThermometerIcon} size={14} />
					Confidence
					{#if lowConfidenceCount > 0}
						<span class="rounded bg-destructive/15 px-1 text-[10px] font-medium text-destructive">
							{lowConfidenceCount}
						</span>
					{/if}
				</Button>

				<Button size="sm" href="/api/export/{documentId}" download class="gap-1.5">
					<HugeiconsIcon icon={Download04Icon} size={14} />
					Export .xlsx
				</Button>
			</span>
		{/if}
	</div>

	<!--
		The heat map was unexplained, so an amber cell read as decoration rather
		than a warning. Turning it on now states what is being measured and what
		each band means — the legend is the feature, the tint is just its index.
	-->
	{#if view === 'workbook' && heat && sheets.length}
		<div
			class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b bg-muted/25 px-3 py-2 text-[11px]"
		>
			<span class="text-muted-foreground">
				Tint shows the <strong class="font-medium text-foreground">lowest</strong> word-level OCR confidence
				in each cell
			</span>
			<span class="flex items-center gap-1.5 text-muted-foreground">
				<span class="size-2.5 rounded-[3px] bg-emerald-500/40"></span> 95%+ read cleanly
			</span>
			<span class="flex items-center gap-1.5 text-muted-foreground">
				<span class="size-2.5 rounded-[3px] bg-amber-500/50"></span> 85–95% slightly unsure
			</span>
			<span class="flex items-center gap-1.5 text-muted-foreground">
				<span class="size-2.5 rounded-[3px] bg-red-500/50"></span> under 85% worth checking
			</span>
			{#if lowConfidenceCount > 0}
				<span class="ml-auto text-muted-foreground">
					{lowConfidenceCount} cell{lowConfidenceCount === 1 ? '' : 's'} on this sheet fall in the last
					band
				</span>
			{/if}
		</div>
	{/if}

	{#if view === 'source'}
		<div class="min-h-0 flex-1">
			<SourceView {documentId} {mimeType} {linkedPaths} onopentable={openTable} />
		</div>
	{:else if !sheets.length}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<span
				class="flex size-12 items-center justify-center rounded-xl border bg-card text-muted-foreground"
			>
				<HugeiconsIcon icon={FileSpreadsheetIcon} size={22} />
			</span>
			<p class="text-sm font-medium">
				{busy ? 'Building your workbook…' : 'No sheets yet'}
			</p>
			<p class="max-w-xs text-sm text-muted-foreground">
				{busy
					? 'Sheets appear here the moment Rowbot creates them.'
					: 'Sheets will appear here once Rowbot reads the document.'}
			</p>
		</div>
	{:else}
		<div class="min-h-0 flex-1">
			{#if active}
				{#key active.id}
					<SheetGrid sheet={active} {heat} bind:selected />
				{/key}
			{/if}
		</div>

		{#if active}
			<CellInspector sheet={active} {selected} />
		{/if}

		<!-- Sheet tabs, at the bottom where a spreadsheet puts them.
		     The wrapper's padding is the composer's exactly, so the agent column
		     and the workbook column finish on the same line instead of one
		     floating above the edge while the other runs into it. -->
		<div class="shrink-0 px-3 pt-2 pb-3">
			<div
				class="flex h-10 items-center gap-1 overflow-x-auto rounded-xl border bg-card px-1.5 shadow-sm"
			>
				{#each sheets as sheet (sheet.id)}
					<button
						type="button"
						class={cn(
							'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors',
							sheet.id === active?.id
								? 'bg-secondary text-foreground'
								: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
						)}
						aria-current={sheet.id === active?.id ? 'true' : undefined}
						onclick={() => {
							activeId = sheet.id;
							selected = null;
						}}
					>
						{sheet.name}
						<span class="text-[11px] text-muted-foreground/60 tabular-nums">
							{Math.max(sheet.rows.length - sheet.headerRows, 0)}
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
