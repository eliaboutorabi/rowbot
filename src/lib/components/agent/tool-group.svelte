<script lang="ts">
	/**
	 * A consecutive run of tool calls, shown as one thing.
	 *
	 * Between two messages the agent might make eight calls, and all eight are
	 * shown. This used to fold all but the last one away by default, which hid
	 * the work in an application whose argument is that you can see the work —
	 * and the reader who wanted it had to go looking for a control that only
	 * appeared once there was something already hidden.
	 *
	 * So it opens, and folds on request. Folded, the whole run goes behind one
	 * count rather than leaving the last step stranded outside it: a group that
	 * has been put away should be put away, and reopening brings back every
	 * step including that one. Groups never merge across a message — the split
	 * between them is the shape of the conversation and worth keeping.
	 */
	import { slide } from 'svelte/transition';
	import Icon from '$lib/components/ui/icon.svelte';
	import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
	import ToolCall from './tool-call.svelte';
	import type { ToolCallView } from '$lib/types/events';

	let { calls }: { calls: ToolCallView[] } = $props();

	let open = $state(true);

	const failures = $derived(calls.filter((call) => call.status === 'error').length);
</script>

<div class="space-y-px">
	{#if calls.length > 1}
		<button
			type="button"
			class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<Icon
				icon={ArrowRight01Icon}
				size={13}
				class="shrink-0 transition-transform {open ? 'rotate-90' : ''}"
			/>
			{calls.length}
			{calls.length === 1 ? 'step' : 'steps'}
			{#if failures > 0}
				<span class="text-destructive">· {failures} failed</span>
			{/if}
		</button>
	{/if}

	{#if open}
		<div transition:slide={{ duration: 150 }} class="space-y-px">
			{#each calls as call (call.id)}
				<ToolCall {call} />
			{/each}
		</div>
	{/if}
</div>
