<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Download04Icon,
		FileSpreadsheetIcon,
		Note01Icon,
		ThermometerIcon
	} from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import SheetGrid from './sheet-grid.svelte';
	import CellInspector from './cell-inspector.svelte';
	import { cn } from '$lib/utils';
	import type { WorkbookModel } from '$lib/types/workbook';

	let {
		workbook,
		documentId,
		busy = false
	}: { workbook: WorkbookModel | null; documentId: string; busy?: boolean } = $props();

	let activeId = $state<string | null>(null);
	let heat = $state(false);
	let selected = $state<{ row: number; column: number } | null>(null);

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

	const lowConfidenceCount = $derived(
		active?.rows.reduce(
			(total, row) => total + row.filter((c) => c.conf !== undefined && c.conf < 0.85).length,
			0
		) ?? 0
	);
</script>

<div class="flex h-full min-w-0 flex-col bg-background">
	{#if !sheets.length}
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
		<!-- Toolbar -->
		<div class="flex h-11 shrink-0 items-center gap-2 border-b px-3">
			<span class="truncate text-sm font-medium">{workbook?.title}</span>

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
							<p class="mb-2 font-medium">What Rowbot wants you to check</p>
							<p class="whitespace-pre-wrap text-muted-foreground">{workbook.notes}</p>
						</Popover.Content>
					</Popover.Root>
				{/if}

				<Button
					variant={heat ? 'secondary' : 'ghost'}
					size="sm"
					class="gap-1.5"
					onclick={() => (heat = !heat)}
					title="Tint cells by how confident the OCR was"
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
		</div>

		<!-- Grid -->
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

		<!-- Sheet tabs, at the bottom where a spreadsheet puts them -->
		<div class="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-t bg-muted/30 px-2">
			{#each sheets as sheet (sheet.id)}
				<button
					type="button"
					class={cn(
						'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition',
						sheet.id === active?.id
							? 'bg-background text-foreground shadow-sm ring-1 ring-border'
							: 'text-muted-foreground hover:bg-accent hover:text-foreground'
					)}
					aria-current={sheet.id === active?.id ? 'true' : undefined}
					onclick={() => {
						activeId = sheet.id;
						selected = null;
					}}
				>
					{sheet.name}
					<span class="ml-1.5 text-[10px] text-muted-foreground/70">
						{Math.max(sheet.rows.length - sheet.headerRows, 0)}
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
