<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Alert01Icon,
		ArrowRight01Icon,
		CheckmarkCircle02Icon,
		Loading03Icon
	} from '@hugeicons/core-free-icons';
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

	/** The latest progress line, shown inline so the card reads as alive. */
	const latest = $derived.by(() => {
		const last = call.progress.at(-1);
		if (!last) return null;
		switch (last.kind) {
			case 'ocr:start':
				return last.label;
			case 'ocr:chunk':
				return last.label;
			case 'ocr:page':
				return `Page ${last.page + 1} · ${last.tables} table${last.tables === 1 ? '' : 's'}${
					last.confidence !== null ? ` · ${(last.confidence * 100).toFixed(0)}% confident` : ''
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

	const hasBody = $derived(Boolean(call.result || call.error || call.progress.length > 1));
</script>

<div
	class={cn(
		'rounded-xl border bg-card transition-colors',
		running && 'border-primary/40 bg-primary/[0.03]',
		failed && 'border-destructive/40 bg-destructive/[0.03]'
	)}
>
	<button
		type="button"
		class="flex w-full items-start gap-3 px-3 py-2.5 text-left"
		disabled={!hasBody}
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span
			class={cn(
				'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border',
				running && 'border-primary/40 text-primary',
				failed && 'border-destructive/40 text-destructive',
				!running && !failed && 'text-muted-foreground'
			)}
		>
			<HugeiconsIcon icon={meta.icon} size={14} />
		</span>

		<span class="min-w-0 flex-1">
			<span class="flex items-baseline gap-2">
				<span class="truncate text-sm font-medium">
					{running ? meta.running : failed ? `${meta.done} — failed` : meta.done}
				</span>
				{#if call.subagent}
					<span
						class="shrink-0 rounded border border-chart-2/40 bg-chart-2/10 px-1.5 py-px text-[10px] font-medium tracking-wide text-chart-2 uppercase"
					>
						{call.subagent}
					</span>
				{/if}
				{#if elapsed !== null && elapsed > 400}
					<span class="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground/70">
						{duration(elapsed)}
					</span>
				{/if}
			</span>

			{#if latest ?? detail}
				<span class="mt-0.5 block truncate text-xs text-muted-foreground">{latest ?? detail}</span>
			{:else if running && call.argsText}
				<!-- Arguments are still streaming: show them arriving. -->
				<span class="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground/70">
					{call.argsText.slice(-70)}
				</span>
			{/if}
		</span>

		<span class="mt-0.5 shrink-0 text-muted-foreground">
			{#if running}
				<HugeiconsIcon icon={Loading03Icon} size={14} class="animate-spin text-primary" />
			{:else if failed}
				<HugeiconsIcon icon={Alert01Icon} size={14} class="text-destructive" />
			{:else if hasBody}
				<HugeiconsIcon
					icon={ArrowRight01Icon}
					size={14}
					class={cn('transition-transform', open && 'rotate-90')}
				/>
			{:else}
				<HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} class="text-chart-2" />
			{/if}
		</span>
	</button>

	{#if open && hasBody}
		<div transition:slide={{ duration: 160 }} class="space-y-2 border-t px-3 py-2.5">
			{#if call.progress.length > 1}
				<ol class="space-y-1 text-xs text-muted-foreground">
					{#each call.progress as step, i (i)}
						<li class="flex gap-2">
							<span class="text-muted-foreground/40">·</span>
							<span class="min-w-0 flex-1">
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
							</span>
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
	{/if}
</div>
