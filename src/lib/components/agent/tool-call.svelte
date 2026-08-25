<script lang="ts">
	/**
	 * One tool call in the activity feed.
	 *
	 * Deliberately a row, not a card. A run makes twenty of these, and twenty
	 * bordered two-line boxes stacked up read as a wall rather than a sequence.
	 * At rest a call is a single quiet line — icon, what it did, what it did it
	 * to, how long it took — and only earns a border when it is running or has
	 * failed. Detail is one click away, indented under a rule so an expanded
	 * call still reads as belonging to its row.
	 */
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Alert01Icon, ArrowRight01Icon, Loading03Icon } from '@hugeicons/core-free-icons';
	import { slide } from 'svelte/transition';
	import { duration } from '$lib/format';
	import { cn } from '$lib/utils';
	import type { ToolCallView } from '$lib/types/events';
	import { toolDetail, toolMeta } from './tool-icon';

	let { call }: { call: ToolCallView } = $props();

	let open = $state(false);

	const meta = $derived(toolMeta(call.name));
	const detail = $derived(toolDetail(call.name, call.args));
	const running = $derived(call.status === 'running');
	const failed = $derived(call.status === 'error');
	const elapsed = $derived(call.endedAt ? call.endedAt - call.startedAt : null);

	/** The latest progress line, shown inline so the row reads as alive. */
	const latest = $derived.by(() => {
		const last = call.progress.at(-1);
		if (!last) return null;
		switch (last.kind) {
			case 'ocr:start':
			case 'ocr:chunk':
				return last.label;
			case 'ocr:page':
				return `Page ${last.page + 1} · ${last.tables} table${last.tables === 1 ? '' : 's'}${
					last.confidence !== null ? ` · ${(last.confidence * 100).toFixed(0)}%` : ''
				}`;
			case 'ocr:done':
				return `${last.tables} table${last.tables === 1 ? '' : 's'} across ${last.pages} page${last.pages === 1 ? '' : 's'}`;
			case 'sheet:written':
				return `${last.name} · ${last.rows}×${last.columns}`;
			case 'sheet:removed':
				return `Removed ${last.name}`;
			case 'cells:edited':
				return `${last.count} cell${last.count === 1 ? '' : 's'} in ${last.sheet}`;
			case 'note':
				return last.text;
		}
	});

	const subtitle = $derived(latest ?? detail);
	const hasBody = $derived(Boolean(call.result || call.error || call.progress.length > 1));
	const title = $derived(running ? meta.running : failed ? meta.done : meta.done);
</script>

<div
	class={cn(
		'rounded-lg transition-colors',
		running && 'bg-primary/[0.06] ring-1 ring-primary/25',
		failed && 'bg-destructive/[0.05] ring-1 ring-destructive/25'
	)}
>
	<button
		type="button"
		class={cn(
			'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
			hasBody && 'hover:bg-accent/60',
			!hasBody && 'cursor-default'
		)}
		disabled={!hasBody}
		aria-expanded={hasBody ? open : undefined}
		onclick={() => (open = !open)}
	>
		<span
			class={cn(
				'flex size-5 shrink-0 items-center justify-center',
				running && 'text-primary',
				failed && 'text-destructive',
				!running && !failed && 'text-muted-foreground/70'
			)}
		>
			<HugeiconsIcon icon={meta.icon} size={15} />
		</span>

		<!-- Title and target share one line: the target is the interesting half,
		     and stacking them doubled the height of every row in the feed. -->
		<span class="flex min-w-0 flex-1 items-baseline gap-2 text-[0.8125rem]">
			<span class={cn('shrink-0 font-medium', failed && 'text-destructive')}>{title}</span>
			{#if subtitle}
				<span class="truncate text-muted-foreground">{subtitle}</span>
			{:else if running && call.argsText}
				<span class="truncate font-mono text-[11px] text-muted-foreground/60">
					{call.argsText.slice(-56)}
				</span>
			{/if}
		</span>

		{#if call.subagent}
			<span
				class="shrink-0 rounded bg-chart-2/12 px-1.5 py-px text-[10px] font-medium tracking-wide text-chart-2 uppercase"
			>
				{call.subagent}
			</span>
		{/if}

		{#if elapsed !== null && elapsed > 400}
			<span class="shrink-0 font-mono text-[11px] text-muted-foreground/60 tabular-nums">
				{duration(elapsed)}
			</span>
		{/if}

		<span class="flex size-4 shrink-0 items-center justify-center">
			{#if running}
				<HugeiconsIcon icon={Loading03Icon} size={13} class="animate-spin text-primary" />
			{:else if failed}
				<HugeiconsIcon icon={Alert01Icon} size={13} class="text-destructive" />
			{:else if hasBody}
				<HugeiconsIcon
					icon={ArrowRight01Icon}
					size={13}
					class={cn(
						'text-muted-foreground/40 transition-transform',
						open ? 'rotate-90 text-muted-foreground' : 'group-hover:text-muted-foreground'
					)}
				/>
			{/if}
		</span>
	</button>

	{#if open && hasBody}
		<div transition:slide={{ duration: 150 }} class="pb-2 pl-[1.65rem]">
			<div class="space-y-2 border-l pl-3">
				{#if call.progress.length > 1}
					<ol class="space-y-1 text-xs text-muted-foreground">
						{#each call.progress as step, i (i)}
							<li>
								{#if step.kind === 'ocr:page'}
									Page {step.page + 1} — {step.tables} table{step.tables === 1 ? '' : 's'}
									{#if step.confidence !== null}
										<span class="text-muted-foreground/60">
											({(step.confidence * 100).toFixed(0)}% confident)
										</span>
									{/if}
								{:else if step.kind === 'ocr:start' || step.kind === 'ocr:chunk'}
									{step.label}
								{:else if step.kind === 'ocr:done'}
									Found {step.tables} table{step.tables === 1 ? '' : 's'} in {step.pages} page{step.pages ===
									1
										? ''
										: 's'}
								{:else if step.kind === 'sheet:written'}
									Wrote {step.name} ({step.rows}×{step.columns})
								{:else if step.kind === 'sheet:removed'}
									Removed {step.name}
								{:else if step.kind === 'cells:edited'}
									Corrected {step.count} cell{step.count === 1 ? '' : 's'} in {step.sheet}
								{:else}
									{step.text}
								{/if}
							</li>
						{/each}
					</ol>
				{/if}

				{#if call.error}
					<p class="text-xs text-destructive">{call.error}</p>
				{:else if call.result}
					<p class="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
						{call.result}
					</p>
				{/if}
			</div>
		</div>
	{/if}
</div>
