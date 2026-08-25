<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { SentIcon, StopIcon } from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import ModelPicker from './model-picker.svelte';
	import { compactNumber } from '$lib/format';
	import type { RunState } from '$lib/stores/run.svelte';

	let {
		run,
		model = $bindable(),
		effort = $bindable(),
		onsend,
		onresume
	}: {
		run: RunState;
		model: string;
		effort: string;
		onsend: (message: string) => void;
		onresume: (value: unknown) => void;
	} = $props();

	let value = $state('');
	let textarea = $state<HTMLTextAreaElement>();

	function grow() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
	}

	function submit() {
		const message = value.trim();
		if (!message || run.busy) return;
		value = '';
		queueMicrotask(grow);
		onsend(message);
	}

	const totalTokens = $derived(run.usage.input + run.usage.output);
</script>

<div class="shrink-0 border-t bg-background/85 p-3 backdrop-blur-md">
	{#if run.interrupt}
		<div class="mb-3 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2.5">
			<p class="text-sm font-medium">Rowbot needs a decision</p>
			<p class="mt-1 text-sm text-muted-foreground">{run.interrupt.question}</p>
			<div class="mt-2.5 flex gap-2">
				<Button size="sm" onclick={() => onresume(true)}>Approve</Button>
				<Button size="sm" variant="outline" onclick={() => onresume(false)}>Reject</Button>
			</div>
		</div>
	{/if}

	<div
		class="rounded-xl border bg-card transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/20"
	>
		<textarea
			bind:this={textarea}
			bind:value
			oninput={grow}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					submit();
				}
			}}
			rows="1"
			placeholder={run.busy
				? 'Rowbot is working — press Stop to interrupt'
				: 'Ask Rowbot for a change…'}
			aria-label="Message Rowbot"
			class="max-h-[180px] min-h-[2.75rem] w-full resize-none bg-transparent px-3.5 py-3 text-sm placeholder:text-muted-foreground focus:outline-none"
		></textarea>

		<div class="flex items-center gap-2 px-2.5 pb-2.5">
			<ModelPicker bind:model bind:effort disabled={run.busy} />

			{#if totalTokens > 0}
				<span class="font-mono text-[11px] text-muted-foreground/70" title="Tokens this run">
					{compactNumber(totalTokens)} tok
					{#if run.usage.reasoning > 0}
						· {compactNumber(run.usage.reasoning)} reasoning
					{/if}
				</span>
			{/if}

			<div class="ml-auto">
				{#if run.busy}
					<Button size="sm" variant="secondary" onclick={() => run.stop()}>
						<HugeiconsIcon icon={StopIcon} size={14} />
						Stop
					</Button>
				{:else}
					<Button size="sm" disabled={!value.trim()} onclick={submit}>
						<HugeiconsIcon icon={SentIcon} size={14} />
						Send
					</Button>
				{/if}
			</div>
		</div>
	</div>
</div>
