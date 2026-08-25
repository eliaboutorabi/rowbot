<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Logout01Icon, Moon02Icon, Settings01Icon, Sun03Icon } from '@hugeicons/core-free-icons';
	import Wordmark from '$lib/components/brand/wordmark.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { theme } from '$lib/theme.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const initials = $derived(
		(data.user.name || data.user.email)
			.split(/[\s@.]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase())
			.join('')
	);

	// The workspace manages its own scrolling panes; the library scrolls normally.
	const isWorkspace = $derived(page.url.pathname.startsWith('/d/'));
</script>

<div class="flex h-dvh flex-col bg-background">
	<header
		class="flex h-14 shrink-0 items-center gap-4 border-b bg-background/85 px-4 backdrop-blur-md"
	>
		<a href={resolve('/documents')} class="shrink-0"><Wordmark size="sm" /></a>

		<div class="flex min-w-0 flex-1 items-center gap-2 text-sm">
			{#if isWorkspace && page.data.document}
				<span class="text-muted-foreground/60" aria-hidden="true">/</span>
				<span class="truncate font-medium">{page.data.document.name}</span>
			{/if}
		</div>

		<Button
			variant="ghost"
			size="icon"
			onclick={() => theme.toggle()}
			aria-label={theme.current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
		>
			<HugeiconsIcon icon={theme.current === 'dark' ? Sun03Icon : Moon02Icon} size={18} />
		</Button>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground transition hover:bg-accent"
						aria-label="Account menu"
					>
						{initials}
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-56">
				<DropdownMenu.Label class="font-normal">
					<div class="truncate text-sm font-medium">{data.user.name}</div>
					<div class="truncate text-xs text-muted-foreground">{data.user.email}</div>
				</DropdownMenu.Label>
				<DropdownMenu.Separator />
				<DropdownMenu.Item class="cursor-pointer">
					{#snippet child({ props })}
						<a {...props} href={resolve('/settings')}>
							<HugeiconsIcon icon={Settings01Icon} size={16} />
							Settings
						</a>
					{/snippet}
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<form method="post" action="/documents?/signOut" class="contents">
					<button type="submit" class="w-full">
						<DropdownMenu.Item class="cursor-pointer">
							<HugeiconsIcon icon={Logout01Icon} size={16} />
							Sign out
						</DropdownMenu.Item>
					</button>
				</form>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</header>

	<div class={isWorkspace ? 'min-h-0 flex-1' : 'min-h-0 flex-1 overflow-y-auto'}>
		{@render children()}
	</div>
</div>
