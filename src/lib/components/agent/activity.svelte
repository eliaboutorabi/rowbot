<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Alert01Icon, AiBrain01Icon } from '@hugeicons/core-free-icons';
	import { fly } from 'svelte/transition';
	import Logo from '$lib/components/brand/logo.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import PlanPanel from './plan-panel.svelte';
	import ToolGroup from './tool-group.svelte';
	import type { RunState, TimelineItem } from '$lib/stores/run.svelte';
	import type { ToolCallView } from '$lib/types/events';

	let { run, empty }: { run: RunState; empty?: import('svelte').Snippet } = $props();

	type Block =
		| { kind: 'entry'; id: string; item: TimelineItem }
		| { kind: 'tools'; id: string; calls: ToolCallView[] };

	/**
	 * Consecutive tool calls collapse into one group. The break is a message —
	 * anything the agent or the user actually said — because that is where the
	 * reader's attention resets.
	 */
	const blocks = $derived.by<Block[]>(() => {
		const out: Block[] = [];
		for (const item of run.timeline) {
			if (item.kind !== 'tool') {
				out.push({ kind: 'entry', id: item.id, item });
				continue;
			}
			const last = out.at(-1);
			if (last?.kind === 'tools') last.calls.push(item.call);
			else out.push({ kind: 'tools', id: item.id, calls: [item.call] });
		}
		return out;
	});

	let viewport = $state<HTMLDivElement>();
	let pinned = $state(true);

	/** Auto-scroll, but stop fighting the user the moment they scroll up. */
	function onScroll() {
		if (!viewport) return;
		const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
		pinned = distance < 80;
	}

	$effect(() => {
		// Reading these is what subscribes the effect to new activity.
		const changed = run.timeline.length + run.todos.length;
		if (changed >= 0 && pinned && viewport) {
			viewport.scrollTo({ top: viewport.scrollHeight });
		}
	});
</script>

<div bind:this={viewport} onscroll={onScroll} class="min-h-0 flex-1 overflow-y-auto">
	<div class="space-y-3 p-4">
		{#if run.timeline.length === 0 && !run.todos.length}
			{#if empty}{@render empty()}{/if}
		{/if}

		<PlanPanel todos={run.todos} />

		{#each blocks as block (block.id)}
			{#if block.kind === 'tools'}
				<div in:fly={{ y: 6, duration: 150 }}>
					<ToolGroup calls={block.calls} />
				</div>
			{:else}
				{@const item = block.item}
				{#if item.kind === 'user'}
					<div class="flex justify-end" in:fly={{ y: 6, duration: 150 }}>
						<p
							class="max-w-[85%] rounded-xl rounded-br-sm bg-primary px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap text-primary-foreground"
						>
							{item.text}
						</p>
					</div>
				{:else if item.kind === 'assistant'}
					<div class="flex gap-2.5" in:fly={{ y: 6, duration: 150 }}>
						<Logo class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
						<div class="min-w-0 flex-1 text-sm leading-relaxed text-foreground/90">
							<!--
							Safe by construction: `renderMarkdown` HTML-escapes the model's
							output before generating any markup, so no tag in the text can
							survive into the DOM. See markdown.spec.ts.
						-->
							<!-- eslint-disable-next-line svelte/no-at-html-tags -->
							{@html renderMarkdown(item.text)}
						</div>
					</div>
				{:else if item.kind === 'notice'}
					<p
						class="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
						in:fly={{ y: 6, duration: 150 }}
					>
						<HugeiconsIcon icon={Alert01Icon} size={15} class="mt-0.5 shrink-0" />
						{item.text}
					</p>
				{/if}
			{/if}
		{/each}

		{#if run.activeSubagents.length}
			<p class="flex items-center gap-2 px-1 text-xs text-muted-foreground">
				<HugeiconsIcon icon={AiBrain01Icon} size={14} class="animate-pulse text-chart-2" />
				{run.activeSubagents.join(', ')} working…
			</p>
		{/if}

		{#if run.busy && !run.runningTools.length}
			<p class="flex items-center gap-2 px-1 text-xs text-muted-foreground">
				<span class="flex gap-1" aria-hidden="true">
					{#each [0, 1, 2] as i (i)}
						<span
							class="size-1.5 animate-bounce rounded-full bg-primary/60"
							style="animation-delay: {i * 120}ms"
						></span>
					{/each}
				</span>
				Thinking
			</p>
		{/if}
	</div>
</div>
