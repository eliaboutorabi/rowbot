<script lang="ts">
	import Icon from '$lib/components/ui/icon.svelte';
	import {
		ArrowRight01Icon,
		CheckmarkCircle02Icon,
		Loading03Icon
	} from '@hugeicons/core-free-icons';
	import { slide } from 'svelte/transition';
	import { cn } from '$lib/utils';
	import type { TodoItem } from '$lib/types/events';

	let {
		todos,
		revised = false
	}: {
		todos: TodoItem[];
		/** True for every plan after the first, so a re-plan reads as a change. */
		revised?: boolean;
	} = $props();

	let open = $state(true);

	const done = $derived(todos.filter((t) => t.status === 'completed').length);
	const active = $derived(todos.find((t) => t.status === 'in_progress'));
	const complete = $derived(todos.length > 0 && done === todos.length);
</script>

{#if todos.length}
	<section class="overflow-hidden rounded-xl border bg-card" aria-label="The agent's plan">
		<button
			type="button"
			class="flex w-full items-center gap-3 px-3 py-2.5 text-left"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<span
				class="shrink-0 text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase"
			>
				{revised ? 'Revised plan' : 'Plan'}
			</span>

			<span class="flex flex-1 items-center gap-2">
				<span
					class="h-1 flex-1 overflow-hidden rounded-full bg-muted"
					role="progressbar"
					aria-valuenow={done}
					aria-valuemin={0}
					aria-valuemax={todos.length}
				>
					<span
						class={cn(
							'block h-full rounded-full transition-[width] duration-500',
							complete ? 'bg-chart-2' : 'bg-primary'
						)}
						style="width: {(done / todos.length) * 100}%"
					></span>
				</span>
				<span class="shrink-0 font-mono text-[11px] text-muted-foreground">
					{done}/{todos.length}
				</span>
			</span>

			<Icon
				icon={ArrowRight01Icon}
				size={14}
				class={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
			/>
		</button>

		{#if !open && active}
			<p class="truncate border-t px-3 py-2 text-xs text-muted-foreground">
				{active.content}
			</p>
		{/if}

		{#if open}
			<ol transition:slide={{ duration: 160 }} class="space-y-1.5 border-t px-3 py-2.5">
				{#each todos as todo, i (i)}
					<li class="flex items-start gap-2.5 text-sm">
						<span class="mt-0.5 shrink-0">
							{#if todo.status === 'completed'}
								<Icon icon={CheckmarkCircle02Icon} size={15} class="text-chart-2" />
							{:else if todo.status === 'in_progress'}
								<Icon icon={Loading03Icon} size={15} class="animate-spin text-accent-ink" />
							{:else}
								<span
									class="mt-[3px] block size-[9px] rounded-full border border-muted-foreground/40"
								></span>
							{/if}
						</span>
						<!--
							No strikethrough on a finished step. The green tick and the
							muted text already say it is done twice over, and a rule drawn
							through a line of prose is the one thing that makes it harder to
							read — which matters here, because the plan is what somebody
							scrolls back to when they want to know what the agent thought it
							was doing.
						-->
						<span
							class={cn(
								'min-w-0 flex-1 leading-snug',
								todo.status === 'completed' && 'text-muted-foreground',
								todo.status === 'in_progress' && 'font-medium'
							)}
						>
							{todo.content}
						</span>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
{/if}
