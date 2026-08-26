<script lang="ts">
	import Icon from '$lib/components/ui/icon.svelte';
	import { Alert01Icon, AiBrain01Icon } from '@hugeicons/core-free-icons';
	import { fly } from 'svelte/transition';
	import Logo from '$lib/components/brand/logo.svelte';
	import { renderMarkdown, renderReferences } from '$lib/markdown';
	import PlanPanel from './plan-panel.svelte';
	import ToolGroup from './tool-group.svelte';
	import type { RunState, TimelineItem } from '$lib/stores/run.svelte';
	import type { ToolCallView } from '$lib/types/events';
	import { toolMeta } from './tool-icon';

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

	/** What the one status line says, from most specific to least. */
	/**
	 * The trailing group of tool calls, when one of them is still running.
	 *
	 * Split out so the status line can sit above it. Everything before has
	 * finished and reads as history; this is the part still moving.
	 */
	const live = $derived.by(() => {
		if (!run.busy) return null;
		const last = blocks.at(-1);
		return last?.kind === 'tools' && last.calls.some((call) => call.status === 'running')
			? last
			: null;
	});

	const settled = $derived(live ? blocks.slice(0, -1) : blocks);

	const status = $derived.by(() => {
		if (run.activeSubagents.length) return `${run.activeSubagents.join(', ')} working…`;
		const running = run.runningTools.at(-1);
		if (running) return toolMeta(running.call.name).running;
		return 'Thinking';
	});

	let viewport = $state<HTMLDivElement>();
	let pinned = $state(true);

	/** Auto-scroll, but stop fighting the user the moment they scroll up. */
	function onScroll() {
		if (!viewport) return;
		const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
		pinned = distance < 80;
	}

	const toBottom = () => viewport?.scrollTo({ top: viewport.scrollHeight });

	$effect(() => {
		// Reading these is what subscribes the effect to new activity.
		const changed = run.timeline.length + run.todos.length;
		if (changed >= 0 && pinned) toBottom();
	});

	/**
	 * Stay at the bottom when the viewport itself shrinks, not only when the
	 * conversation grows.
	 *
	 * Everything below this column can change height under it — the suggestion
	 * strip appears when a turn finishes, the composer grows with a long
	 * message — and each of those takes rows away from the bottom of the
	 * conversation without anything here changing. The effect above never fires,
	 * so the last thing the agent said slides up out of view at the exact moment
	 * the reviewer is being asked what to do about it.
	 */
	$effect(() => {
		if (!viewport) return;
		const observer = new ResizeObserver(() => {
			if (pinned) toBottom();
		});
		observer.observe(viewport);
		return () => observer.disconnect();
	});
</script>

<div bind:this={viewport} onscroll={onScroll} class="scroll-slim min-h-0 flex-1 overflow-y-auto">
	<!--
		A reading measure. In the two-column layout the conversation is 22–32rem
		wide and constrains itself; below `lg` it takes the whole window, and on a
		tablet that put the agent's prose on 100-character lines. The cap only
		bites where the column is wider than it should be.
	-->
	<!--
		Extra room at the foot. The composer casts a 24px fade up over the feed so
		text does not collide with its edge — which means the last line, scrolled
		fully into view, was still sitting half inside the fade. The padding is
		what lets it clear.
	-->
	<div class="mx-auto max-w-2xl space-y-3 p-4 pb-9">
		{#if run.timeline.length === 0 && !run.todos.length}
			{#if empty}{@render empty()}{/if}
		{/if}

		{#each settled as block (block.id)}
			{#if block.kind === 'entry' && block.item.kind === 'plan'}
				<div in:fly={{ y: 6, duration: 150 }}>
					<PlanPanel todos={block.item.todos} revised={block.id !== firstPlanId} />
				</div>
			{:else if block.kind === 'tools'}
				<!-- No entrance transition: a tool group is created and then mutates
				     as the run streams into it, so animating its arrival adds a shift
				     to a block that is already moving. -->
				<ToolGroup calls={block.calls} />
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
							<!--
								A reference the composer attached is shown as the chip it is,
								not as the `[['Sheet'!A:A]]` that goes over the wire. It reads
								as a rendering fault otherwise, and it is the one piece of
								markup in the message the app put there itself.

								Safe by construction: `renderReferences` escapes the text
								before it turns any of it into markup, and applies nothing
								except the reference chips. See markdown.spec.ts.
							-->
							<!-- eslint-disable-next-line svelte/no-at-html-tags -->
							{@html renderReferences(item.text)}
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
						<Icon icon={Alert01Icon} size={15} class="mt-0.5 shrink-0" />
						{item.text}
					</p>
				{/if}
			{/if}
		{/each}

		<!--
			The status line, and under it whatever is running right now.

			It used to sit below everything, so a live tool card appeared above
			the words describing it and the eye went to the wrong place. Thinking
			first, then the work: the order it happens in. At half the height it
			had, too — it is a status, not a message.
		-->
		{#if run.busy}
			<p
				class="flex h-5 items-center gap-2 px-1 text-[0.6875rem] text-muted-foreground"
				aria-live="polite"
			>
				{#if run.activeSubagents.length}
					<Icon icon={AiBrain01Icon} size={12} class="animate-pulse text-chart-2" />
				{:else}
					<span class="flex items-center gap-[3px]" aria-hidden="true">
						{#each [0, 1, 2] as i (i)}
							<span
								class="think-dot size-1.5 rounded-full bg-primary"
								style="animation-delay: {i * 160}ms"
							></span>
						{/each}
					</span>
				{/if}
				<span class="think-text truncate">{status}</span>
			</p>
		{/if}

		{#if live}
			<ToolGroup calls={live.calls} />
		{/if}
	</div>
</div>
