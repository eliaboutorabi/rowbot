<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ArrowDown01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { EFFORTS, MODELS, effortLabel, modelLabel } from '$lib/models';
	import { cn } from '$lib/utils';

	let {
		model = $bindable(),
		effort = $bindable(),
		disabled = false
	}: { model: string; effort: string; disabled?: boolean } = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger {disabled}>
		{#snippet child({ props })}
			<button
				{...props}
				class="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs font-medium transition hover:bg-accent disabled:opacity-50"
			>
				<span>{modelLabel(model)}</span>
				<span class="text-muted-foreground" aria-hidden="true">·</span>
				<span class="text-muted-foreground">{effortLabel(effort)}</span>
				<HugeiconsIcon icon={ArrowDown01Icon} size={13} class="text-muted-foreground" />
			</button>
		{/snippet}
	</DropdownMenu.Trigger>

	<DropdownMenu.Content align="end" class="w-72">
		<DropdownMenu.Label>Model</DropdownMenu.Label>
		{#each MODELS as option (option.id)}
			<DropdownMenu.Item
				class="cursor-pointer items-start gap-2"
				onSelect={() => (model = option.id)}
			>
				<HugeiconsIcon
					icon={CheckmarkCircle02Icon}
					size={15}
					class={cn('mt-0.5 shrink-0', model === option.id ? 'text-accent-ink' : 'opacity-0')}
				/>
				<span class="min-w-0">
					<span class="block text-sm font-medium">{option.label}</span>
					<span class="block text-xs leading-snug text-muted-foreground">{option.blurb}</span>
				</span>
			</DropdownMenu.Item>
		{/each}

		<DropdownMenu.Separator />
		<DropdownMenu.Label>Reasoning effort</DropdownMenu.Label>
		{#each EFFORTS as option (option.id)}
			<DropdownMenu.Item
				class="cursor-pointer items-start gap-2"
				onSelect={() => (effort = option.id)}
			>
				<HugeiconsIcon
					icon={CheckmarkCircle02Icon}
					size={15}
					class={cn('mt-0.5 shrink-0', effort === option.id ? 'text-accent-ink' : 'opacity-0')}
				/>
				<span class="min-w-0">
					<span class="block text-sm font-medium">{option.label}</span>
					<span class="block text-xs leading-snug text-muted-foreground">{option.blurb}</span>
				</span>
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
