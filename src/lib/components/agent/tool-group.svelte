<script lang="ts">
	/**
	 * A consecutive run of tool calls, shown as one thing.
	 *
	 * Between two messages the agent might make eight calls. Listing all eight
	 * buries the conversation in machinery, so a group shows only its most
	 * recent step — the one that is either running or just finished — and folds
	 * the rest behind a count. Groups never merge across a message: the split
	 * between them is the shape of the conversation and worth keeping.
	 */
	import { slide } from 'svelte/transition';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
	import ToolCall from './tool-call.svelte';
	import type { ToolCallView } from '$lib/types/events';

	let { calls }: { calls: ToolCallView[] } = $props();

	let open = $state(false);

	const hidden = $derived(Math.max(calls.length - 1, 0));
	const shown = $derived(open ? calls : calls.slice(-1));
	const failures = $derived(calls.filter((call) => call.status === 'error').length);
</script>

<div class="space-y-px">
	{#if hidden > 0}
		<button
			type="button"
			class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<HugeiconsIcon
				icon={ArrowRight01Icon}
				size={13}
				class="shrink-0 transition-transform {open ? 'rotate-90' : ''}"
			/>
			{#if open}
				Hide {hidden} earlier {hidden === 1 ? 'step' : 'steps'}
			{:else}
				{hidden} earlier {hidden === 1 ? 'step' : 'steps'}
			{/if}
			{#if failures > 0}
				<span class="text-destructive">· {failures} failed</span>
			{/if}
		</button>
	{/if}

	{#if open}
		<div transition:slide={{ duration: 150 }} class="space-y-px">
			{#each shown as call (call.id)}
				<ToolCall {call} />
			{/each}
		</div>
	{:else}
		{#each shown as call (call.id)}
			<ToolCall {call} />
		{/each}
	{/if}
</div>
