<script lang="ts">
	import Logo from './logo.svelte';
	import { cn } from '$lib/utils';

	let {
		class: className,
		size = 'md',
		hideText = false
	}: {
		class?: string;
		size?: 'sm' | 'md' | 'lg';
		/** Drop the word below `sm`, where the nav has no room for it. */
		hideText?: boolean;
	} = $props();

	const marks = { sm: 'size-6', md: 'size-8', lg: 'size-11' };
	const words = { sm: 'text-base', md: 'text-lg', lg: 'text-2xl' };
</script>

<span class={cn('inline-flex items-center gap-2 text-foreground', className)}>
	<Logo class={marks[size]} />
	<span class={cn('font-semibold tracking-tight', words[size], hideText && 'hidden sm:inline')}>
		Row<span class="text-primary">bot</span>
	</span>
</span>
