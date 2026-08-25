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
	/** Everything after the first plan is a revision, and says so. */
	const firstPlanId = $derived(run.timeline.find((item) => item.kind === 'plan')?.id);

	/**
	 * `write_todos` is reported twice — once as the plan panel, once as a tool
	 * row saying "Updated the plan" — and the panel is the version worth
	 * reading. The row survived only to carry a duration, and because plan
	 * writes tend to land last in a group, it was frequently the one line a
	 * collapsed group chose to show.
	 */
	const PLAN_TOOL = 'write_todos';

	const blocks = $derived.by<Block[]>(() => {
		const out: Block[] = [];
		for (const item of run.timeline) {
			if (item.kind !== 'tool') {
				out.push({ kind: 'entry', id: item.id, item });
				continue;
			}
			if (item.call.name === PLAN_TOOL) continue;
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

<div
	bind:this={viewport}
	onscroll={onScroll}
	class="scroll-slim scroll-quiet min-h-0 flex-1 overflow-y-auto"
>
	<div class="space-y-3 p-4">
		{#if run.timeline.length === 0 && !run.todos.length}
			{#if empty}{@render empty()}{/if}
		{/if}

		{#each blocks as block (block.id)}
			{#if block.kind === 'entry' && block.item.kind === 'plan'}
				<div in:fly={{ y: 6, duration: 150 }}>
					<PlanPanel todos={block.item.todos} revised={block.id !== firstPlanId} />
				</div>
			{:else if block.kind === 'tools'}
				<div in:fly={{ y: 6, duration: 150 }}>
					<ToolGroup calls={block.calls} />
				</div>
			{:else}
				{@const item = block.item}
				{#if item.kind === 'user'}
					<!--
						A tinted surface, not a filled brand block. At the length people
						actually type, a solid crimson rectangle was the loudest thing on
						the screen and it was the least interesting — the accent belongs on
						the one control that exports the work, not on every line of input.
						The tint plus the tail is enough to say who is speaking.
					-->
					<div class="flex justify-end" in:fly={{ y: 6, duration: 150 }}>
						<p
							class="max-w-[85%] rounded-xl rounded-br-sm bg-primary/[0.09] px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground ring-1 ring-primary/15 dark:bg-primary/20 dark:ring-primary/25"
						>
							{item.text}
						</p>
					</div>
				{:else if item.kind === 'assistant'}
					<div class="flex gap-2.5" in:fly={{ y: 6, duration: 150 }}>
						<!--
							A 24px chip against a 24px first line. Both boxes start at the
							same y and are the same height, so the mark centres on line one
							by construction — the previous `mt-0.5` was a guess against a
							1.625 line-height, and the mark's own visual mass sits low in
							its box because of the antenna, so the guess read as unaligned.
						-->
						<span
							class="mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
						>
							<Logo class="size-[15px]" />
						</span>
						<div
							class="min-w-0 flex-1 pt-px text-sm leading-6 text-foreground/90 [&>*:first-child]:mt-0"
						>
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
