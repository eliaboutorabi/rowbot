<script lang="ts">
	/**
	 * The message composer.
	 *
	 * Shaped after the composers people actually use every day: one raised,
	 * generously-rounded surface that owns the bottom of the column, roomy
	 * 15px text, and a single circular action button in the corner rather than
	 * a labelled pill. The controls that qualify a message — model, effort —
	 * sit on a quiet second line inside the same surface, so the composer reads
	 * as one object instead of a textarea with a toolbar bolted underneath.
	 */
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		ArrowRight01Icon,
		ArrowUp01Icon,
		HelpCircleIcon,
		StopIcon
	} from '@hugeicons/core-free-icons';
	import ModelPicker from './model-picker.svelte';
	import { compactNumber } from '$lib/format';
	import { cn } from '$lib/utils';
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
		textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
	}

	function submit() {
		const message = value.trim();
		if (!message || run.busy) return;
		value = '';
		queueMicrotask(grow);

		// While a question is outstanding, what you type is the answer to it —
		// sending it as a fresh turn would strand the suspended run.
		if (run.interrupt) onresume(message);
		else onsend(message);
	}

	const totalTokens = $derived(run.usage.input + run.usage.output);
	const canSend = $derived(Boolean(value.trim()) && !run.busy);
</script>

<div class="relative shrink-0 px-3 pt-2 pb-3">
	<!-- Feed content scrolls under the composer; this fades it out rather than
	     letting text collide with the surface edge. -->
	<div
		class="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-background to-transparent"
		aria-hidden="true"
	></div>

	{#if run.interrupt}
		{@const ask = (run.interrupt.payload ?? {}) as {
			context?: string;
			options?: Array<{ value: string; label: string; detail?: string }>;
			defaultChoice?: string;
		}}
		<!--
			The agent has suspended and the checkpoint is holding everything it has
			done. Each option owns a row: label, then what choosing it does. The
			first draft put the buttons in one wrap and their consequences in a
			list underneath, so you had to match them up by reading order.
		-->
		<div class="mb-2 overflow-hidden rounded-2xl border border-primary/35 bg-primary/[0.05]">
			<div class="flex items-start gap-2.5 px-3.5 pt-3">
				<span
					class="mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary"
				>
					<HugeiconsIcon icon={HelpCircleIcon} size={15} />
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-[10px] font-semibold tracking-[0.09em] text-primary uppercase">
						Paused for you
					</p>
					<p class="mt-1 text-sm leading-relaxed font-medium text-balance">
						{run.interrupt.question}
					</p>
					{#if ask.context}
						<p class="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{ask.context}</p>
					{/if}
				</div>
			</div>

			{#if ask.options?.length}
				<div class="mt-3 divide-y border-t border-primary/15">
					{#each ask.options as option (option.value)}
						<button
							type="button"
							class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-primary/8 focus-visible:bg-primary/8 focus-visible:outline-none"
							onclick={() => onresume(option.value)}
						>
							<span class="min-w-0 flex-1">
								<span class="flex items-center gap-1.5 text-[13px] font-medium">
									{option.label}
									{#if option.value === ask.defaultChoice}
										<span class="text-[10px] font-normal text-muted-foreground">suggested</span>
									{/if}
								</span>
								{#if option.detail}
									<span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
										{option.detail}
									</span>
								{/if}
							</span>
							<HugeiconsIcon
								icon={ArrowRight01Icon}
								size={15}
								class="shrink-0 text-muted-foreground/40"
							/>
						</button>
					{/each}
				</div>
			{/if}

			<p class="border-t border-primary/15 px-3.5 py-2 text-xs text-muted-foreground">
				Or write your own answer below.
			</p>
		</div>
	{/if}

	<div
		class="rounded-3xl border bg-card shadow-lg shadow-black/[0.04] transition-shadow focus-within:border-primary/40 focus-within:shadow-xl focus-within:shadow-primary/[0.06] dark:shadow-black/25"
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
			placeholder={run.interrupt
				? 'Answer Rowbot…'
				: run.busy
					? 'Rowbot is working…'
					: 'Ask Rowbot for a change…'}
			aria-label="Message Rowbot"
			class="max-h-[200px] min-h-[1.5rem] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[0.9375rem] leading-relaxed placeholder:text-muted-foreground focus:outline-none"
		></textarea>

		<div class="flex items-center gap-2 px-2.5 pb-2.5 pl-3">
			<ModelPicker bind:model bind:effort disabled={run.busy} />

			{#if totalTokens > 0}
				<span
					class="hidden font-mono text-[11px] text-muted-foreground/60 tabular-nums sm:inline"
					title="Tokens used on this run"
				>
					{compactNumber(totalTokens)}
					{#if run.usage.reasoning > 0}
						· {compactNumber(run.usage.reasoning)} reasoning
					{/if}
				</span>
			{/if}

			{#if run.busy}
				<button
					type="button"
					onclick={() => run.stop()}
					aria-label="Stop Rowbot"
					class="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
				>
					<HugeiconsIcon icon={StopIcon} size={15} />
				</button>
			{:else}
				<button
					type="button"
					onclick={submit}
					disabled={!canSend}
					aria-label="Send message"
					class={cn(
						'ml-auto flex size-8 shrink-0 items-center justify-center rounded-full transition-all focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
						canSend
							? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-95'
							: 'cursor-not-allowed bg-muted text-muted-foreground/50'
					)}
				>
					<HugeiconsIcon icon={ArrowUp01Icon} size={17} strokeWidth={2.4} />
				</button>
			{/if}
		</div>
	</div>
</div>
