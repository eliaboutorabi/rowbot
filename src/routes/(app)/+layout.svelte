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
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Icon from '$lib/components/ui/icon.svelte';
	import { Cancel01Icon, Logout01Icon } from '@hugeicons/core-free-icons';
	import Rail from '$lib/components/app/rail.svelte';
	import ResizeEdge from '$lib/components/app/resize-edge.svelte';
	import ProjectsPanel from '$lib/components/app/projects-panel.svelte';
	import SettingsPanel from '$lib/components/app/settings-panel.svelte';
	import { Button } from '$lib/components/ui/button';
	import { sidebar } from '$lib/stores/sidebar.svelte';
	import { widths } from '$lib/stores/layout.svelte';
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

	/** The chord this reader actually presses. */
	const QUICK_OPEN =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
			? '\u2318K'
			: 'Ctrl+K';

	// Widths are a preference, so they are remembered — but only read once the
	// browser is here, or the server's HTML and the first paint would disagree
	// and the column would visibly jump on load.
	onMount(() => widths.hydrate());

	/**
	 * ⌘K opens the project list. A list you have to reach for the mouse to open
	 * is a list you use once.
	 */
	function onKeydown(event: KeyboardEvent) {
		if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
		event.preventDefault();
		if (sidebar.open !== 'projects') sidebar.toggle('projects');
	}

	// Arriving at the library with the project list open would show the same
	// thing twice, in two sizes, side by side.
	$effect(() => {
		if (page.url.pathname.startsWith('/documents') && sidebar.open === 'projects') {
			sidebar.toggle('projects');
		}
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex h-dvh bg-background">
	<Rail {initials} />

	{#if showing}
		<!--
			Slides rather than appearing. A three-hundred-pixel column arriving
			between one frame and the next reads as the layout breaking; two tenths
			of a second of it moving in reads as it opening. The inner column keeps
			its own fixed width so the contents do not reflow on the way.
		-->
		<!-- Escape lives on the panel so it cannot be mistaken for a global key;
		     the listener is a keyboard convenience over a region, not a control. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<aside
			class="relative flex shrink-0 flex-col overflow-hidden border-r bg-rail"
			aria-label={TITLES[showing]}
			transition:slide={{ axis: 'x', duration: 200, easing: cubicOut }}
			onkeydown={(event) => {
				// Scoped to the panel by where the listener lives rather than by
				// asking afterwards what the event hit: Escape in the composer
				// belongs to the composer, and closing the conversation out from
				// under someone mid-sentence is not what they meant by it.
				if (event.key !== 'Escape' || !showing) return;
				event.stopPropagation();
				sidebar.toggle(showing);
			}}
		>
			<ResizeEdge column="panel" />
			<div class="flex min-h-0 flex-1 flex-col" style:width="{widths.panel}px">
				<header class="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
					<h1 class="flex min-w-0 items-center gap-2 text-[0.8125rem] font-medium">
						<span class="truncate">{TITLES[showing]}</span>
						{#if showing === 'projects'}
							<!-- A shortcut nobody is told about is a shortcut nobody uses. -->
							<kbd
								class="shrink-0 rounded border bg-background px-1.5 py-px font-sans text-[10px] font-normal text-muted-foreground"
							>
								{QUICK_OPEN}
							</kbd>
						{/if}
					</h1>
					<button
						type="button"
						class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
						aria-label="Close"
						onclick={() => sidebar.toggle(showing)}
					>
						<Icon icon={Cancel01Icon} size={15} />
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
								<Icon icon={Logout01Icon} size={15} />
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
