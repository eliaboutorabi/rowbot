<script lang="ts">
	/**
	 * A few things worth asking for next.
	 *
	 * A document used to start working the moment it opened, which decided for
	 * the reviewer what the first turn would be and gave them nothing to read
	 * while it happened. Offering the two or three obvious openings instead
	 * costs a click and hands back the choice — and the same pattern serves at
	 * the other end of a run, where "what now?" is a real question and the
	 * answers are nearly always the same handful.
	 */
	import Icon from '$lib/components/ui/icon.svelte';
	import { cn } from '$lib/utils';
	import type { IconSvgElement } from '@hugeicons/svelte';

	export interface Suggestion {
		label: string;
		prompt: string;
		icon: IconSvgElement;
	}

	let {
		items,
		onpick,
		disabled = false,
		class: className
	}: {
		items: Suggestion[];
		onpick: (prompt: string) => void;
		disabled?: boolean;
		class?: string;
	} = $props();
</script>

<div class={cn('flex flex-wrap justify-center gap-2', className)}>
	{#each items as item (item.label)}
		<button
			type="button"
			{disabled}
			onclick={() => onpick(item.prompt)}
			class="group flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-[0.8125rem] font-medium text-foreground/85 shadow-sm transition-all hover:-translate-y-px hover:border-primary/40 hover:bg-accent/50 hover:text-foreground hover:shadow focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 motion-reduce:hover:translate-y-0"
		>
			<Icon
				icon={item.icon}
				size={14}
				class="shrink-0 text-muted-foreground transition-colors group-hover:text-accent-ink"
			/>
			{item.label}
		</button>
	{/each}
</div>
