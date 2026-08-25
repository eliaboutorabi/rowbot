<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import Icon from '$lib/components/ui/icon.svelte';
	import { ArrowUp01Icon } from '@hugeicons/core-free-icons';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<SelectPrimitive.ScrollUpButtonProps> = $props();
</script>

<SelectPrimitive.ScrollUpButton
	bind:ref
	data-slot="select-scroll-up-button"
	class={cn(
		"top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-3.5",
		className
	)}
	{...restProps}
>
	<Icon icon={ArrowUp01Icon} strokeWidth={2} />
</SelectPrimitive.ScrollUpButton>
