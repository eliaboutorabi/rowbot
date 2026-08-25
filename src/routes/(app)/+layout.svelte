<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		ArrowRight01Icon,
		Logout01Icon,
		Moon02Icon,
		Settings01Icon,
		Sun03Icon
	} from '@hugeicons/core-free-icons';
	import Wordmark from '$lib/components/brand/wordmark.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { theme } from '$lib/theme.svelte';
	import { cn } from '$lib/utils';
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

	interface Crumb {
		label: string;
		/** Only the library is ever linkable, so this is a flag rather than a URL —
		 *  which also keeps `resolve()` a literal call at the anchor, where
		 *  SvelteKit's typed-routing lint can see it. */
		toLibrary?: boolean;
	}

	/**
	 * Where you are, derived from the route rather than passed down by each
	 * page — one place to change when a route is added, and no page can forget
	 * to set it.
	 */
	const crumbs = $derived.by<Crumb[]>(() => {
		const path = page.url.pathname;
		if (path.startsWith('/d/')) {
			const name = page.data.document?.name;
			return [{ label: 'Documents', toLibrary: true }, ...(name ? [{ label: name }] : [])];
		}
		if (path.startsWith('/settings')) return [{ label: 'Settings' }];
		if (path.startsWith('/documents')) return [{ label: 'Documents' }];
		return [];
	});
</script>

<div class="flex h-dvh flex-col bg-background">
	<header class="flex h-14 shrink-0 items-center gap-2 border-b bg-rail/85 px-3 backdrop-blur-xl">
		<!--
			`flex` rather than the default inline anchor: an inline-flex child of an
			inline parent sits on the text baseline, which left the wordmark 3.2px
			above the optical centre of everything else in the bar.
		-->
		<a
			href={resolve('/documents')}
			class="flex shrink-0 items-center rounded-lg px-1.5 py-1 transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
		>
			<Wordmark size="sm" hideText />
		</a>

		{#if crumbs.length}
			<span class="h-5 w-px shrink-0 bg-border" aria-hidden="true"></span>

			<nav class="flex min-w-0 flex-1 items-center gap-0.5 text-sm" aria-label="Breadcrumb">
				{#each crumbs as crumb, i (crumb.label)}
					{#if i > 0}
						<!-- The trail is a desktop luxury; a phone has room for one place. -->
						<HugeiconsIcon
							icon={ArrowRight01Icon}
							size={15}
							class="hidden shrink-0 text-muted-foreground sm:block"
						/>
					{/if}
					{#if crumb.toLibrary}
						<a
							href={resolve('/documents')}
							class={cn(
								'shrink-0 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground',
								crumbs.length > 1 && 'hidden sm:block'
							)}
						>
							{crumb.label}
						</a>
					{:else}
						<span class="truncate px-1.5 py-1 font-medium" aria-current="page">{crumb.label}</span>
					{/if}
				{/each}
			</nav>
		{:else}
			<div class="flex-1"></div>
		{/if}

		<div class="flex shrink-0 items-center gap-0.5">
			<Button
				variant="ghost"
				size="icon"
				href={resolve('/settings')}
				aria-label="Settings"
				title="Settings"
			>
				<HugeiconsIcon icon={Settings01Icon} size={18} />
			</Button>

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
							class="flex size-9 items-center justify-center rounded-full bg-secondary text-[0.8125rem] font-semibold text-secondary-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none aria-expanded:bg-accent"
							aria-label="Account menu"
						>
							{initials}
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-60">
					<DropdownMenu.Label class="font-normal">
						<div class="truncate text-sm font-medium">{data.user.name}</div>
						<div class="truncate text-xs text-muted-foreground">{data.user.email}</div>
					</DropdownMenu.Label>
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
		</div>
	</header>

	<div class={isWorkspace ? 'min-h-0 flex-1' : 'scroll-slim min-h-0 flex-1 overflow-y-auto'}>
		{@render children()}
	</div>
</div>
