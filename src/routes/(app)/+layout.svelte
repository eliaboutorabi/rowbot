<script lang="ts">
	/**
	 * One rail, one optional panel, and the page.
	 *
	 * There used to be a fourteen-rem-tall bar across the top carrying a
	 * wordmark, a breadcrumb and four buttons. It cost the workbook the one
	 * dimension it has least of and spent it on chrome that is glanced at once
	 * a session. All of it is in the rail now, and the sheet starts at the top
	 * of the window.
	 */
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Cancel01Icon, Logout01Icon } from '@hugeicons/core-free-icons';
	import Rail from '$lib/components/app/rail.svelte';
	import ProjectsPanel from '$lib/components/app/projects-panel.svelte';
	import SettingsPanel from '$lib/components/app/settings-panel.svelte';
	import { Button } from '$lib/components/ui/button';
	import { sidebar } from '$lib/stores/sidebar.svelte';
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

	/**
	 * The conversation is a panel of the sidebar, but it is rendered by the
	 * workspace, which owns the run. So these two are the panels the layout
	 * itself draws.
	 */
	const showing = $derived(sidebar.open === 'chat' ? null : sidebar.open);

	const TITLES = { projects: 'Projects', settings: 'Settings', account: 'Account' } as const;

	// Arriving at the library with the project list open would show the same
	// thing twice, in two sizes, side by side.
	$effect(() => {
		if (page.url.pathname.startsWith('/documents') && sidebar.open === 'projects') {
			sidebar.toggle('projects');
		}
	});
</script>

<div class="flex h-dvh bg-background">
	<Rail {initials} />

	{#if showing}
		<!--
			Slides rather than appearing. A three-hundred-pixel column arriving
			between one frame and the next reads as the layout breaking; two tenths
			of a second of it moving in reads as it opening. The inner column keeps
			its own fixed width so the contents do not reflow on the way.
		-->
		<aside
			class="flex shrink-0 flex-col overflow-hidden border-r bg-rail"
			aria-label={TITLES[showing]}
			transition:slide={{ axis: 'x', duration: 200, easing: cubicOut }}
		>
			<div class="flex min-h-0 w-80 flex-1 flex-col">
				<header class="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
					<h1 class="truncate text-[0.8125rem] font-medium">{TITLES[showing]}</h1>
					<button
						type="button"
						class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
						aria-label="Close"
						onclick={() => sidebar.toggle(showing)}
					>
						<HugeiconsIcon icon={Cancel01Icon} size={15} />
					</button>
				</header>

				{#if showing === 'projects'}
					<ProjectsPanel documents={data.documents} />
				{:else if showing === 'settings'}
					<SettingsPanel allowance={data.allowance} />
				{:else}
					<div class="flex flex-1 flex-col gap-4 p-4">
						<div class="min-w-0">
							<p class="truncate font-medium">{data.user.name}</p>
							<p class="truncate text-sm text-muted-foreground">{data.user.email}</p>
						</div>

						<form method="post" action="/documents?/signOut" class="contents">
							<Button type="submit" variant="outline" size="sm" class="w-full justify-center gap-2">
								<HugeiconsIcon icon={Logout01Icon} size={15} />
								Sign out
							</Button>
						</form>
					</div>
				{/if}
			</div>
		</aside>
	{/if}

	<div
		class={isWorkspace
			? 'min-h-0 min-w-0 flex-1'
			: 'scroll-slim min-h-0 min-w-0 flex-1 overflow-y-auto'}
	>
		{@render children()}
	</div>
</div>
