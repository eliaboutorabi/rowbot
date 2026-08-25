<script lang="ts">
	/**
	 * The app's only chrome: a column of icons, fifty-two pixels wide.
	 *
	 * A horizontal bar spends the one dimension a spreadsheet has least of on
	 * four buttons; a rail spends a sliver of the dimension there is plenty of,
	 * and the sheet starts at the top of the window.
	 *
	 * No boxes. An icon in a filled rounded container is a button drawn twice —
	 * the icon already reads as pressable, and a column of six chips reads as a
	 * toolbar rather than as chrome. Active is the accent colour on the mark
	 * itself, which is the whole signal and needs no rule beside it.
	 *
	 * The mark at the top is the way to the library. There is no second one:
	 * two controls that go to the same place is one too many, so the projects
	 * button opens the list *here* instead, which is faster than the trip.
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import type { IconSvgElement } from '@hugeicons/svelte';
	import {
		DashboardSquare01Icon,
		Message01Icon,
		Moon02Icon,
		Settings01Icon,
		Sun03Icon
	} from '@hugeicons/core-free-icons';
	import Logo from '$lib/components/brand/logo.svelte';
	import { theme } from '$lib/theme.svelte';
	import { activity } from '$lib/stores/activity.svelte';
	import { sidebar, type SidebarPanel } from '$lib/stores/sidebar.svelte';
	import { cn } from '$lib/utils';

	let { initials }: { initials: string } = $props();

	const isWorkspace = $derived(page.url.pathname.startsWith('/d/'));
	const onLibrary = $derived(page.url.pathname.startsWith('/documents'));
</script>

{#snippet railButton(panel: SidebarPanel, icon: IconSvgElement, label: { on: string; off: string })}
	{@const active = sidebar.open === panel}
	<button
		type="button"
		class={cn(
			'flex size-9 items-center justify-center rounded-lg transition-[color,transform] duration-150 active:scale-90',
			active ? 'text-accent-ink' : 'text-muted-foreground hover:text-foreground'
		)}
		aria-pressed={active}
		aria-label={active ? label.on : label.off}
		title={active ? label.on : label.off}
		onclick={() => sidebar.toggle(panel)}
	>
		<HugeiconsIcon {icon} size={19} />
	</button>
{/snippet}

<!-- `data-rail` names this for the view transition: identical on both sides
     of a navigation, so the browser carries it across rather than fading it
     out and drawing it again. -->
<nav
	data-rail
	class="flex w-13 shrink-0 flex-col items-center gap-1.5 border-r bg-rail py-3"
	aria-label="Rowbot"
>
	<a
		href={resolve('/documents')}
		class="mb-1.5 flex size-9 items-center justify-center rounded-lg text-foreground transition-[opacity,transform] duration-150 hover:opacity-70 active:scale-90"
		aria-label="Rowbot — go to the library"
		title="Rowbot"
	>
		<Logo class="size-[23px]" />
	</a>

	{#if isWorkspace}
		<!--
			Desktop only. Below `lg` the workspace shows one pane at a time through
			its own Rowbot/Workbook switcher, and this button would be a control
			that visibly does nothing — worse than no control at all.
		-->
		<div class="relative hidden lg:block">
			{@render railButton('chat', Message01Icon, {
				on: 'Hide the conversation',
				off: 'Show the conversation'
			})}

			<!--
				What the collapsed conversation used to say on a rail of its own:
				that Rowbot is working, and how far through the plan it is. Only
				while the panel is hidden — with it open the feed says all of this
				at full size, and a badge over the button is noise.
			-->
			{#if sidebar.open !== 'chat'}
				{#if activity.failed}
					<span
						class="pointer-events-none absolute top-0 right-0 size-2 rounded-full bg-destructive ring-2 ring-rail"
						title="The last run failed"
					></span>
				{:else if activity.busy}
					<span
						class="pointer-events-none absolute top-0 right-0 size-2 animate-pulse rounded-full bg-accent-ink ring-2 ring-rail"
						title={activity.total
							? `Working · ${activity.done} of ${activity.total} steps done`
							: 'Rowbot is working'}
					></span>
				{/if}

				{#if activity.total > 0}
					<span
						class="pointer-events-none mt-0.5 block text-center text-[10px] leading-none font-medium text-muted-foreground tabular-nums"
						title="{activity.done} of {activity.total} plan steps done"
					>
						{activity.done}/{activity.total}
					</span>
				{/if}
			{/if}
		</div>
	{/if}

	<!--
		Not in the library, where the same list is already the page. The panel
		exists to hop between projects while you are working on one; offering it
		here would be the third door to the room you are standing in.
	-->
	{#if !onLibrary}
		{@render railButton('projects', DashboardSquare01Icon, {
			on: 'Close the project list',
			off: 'Your projects'
		})}
	{/if}
	<div class="flex-1"></div>

	<button
		type="button"
		class="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-[color,transform] duration-150 hover:text-foreground active:scale-90"
		onclick={() => theme.toggle()}
		aria-label={theme.current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
		title={theme.current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
	>
		<HugeiconsIcon icon={theme.current === 'dark' ? Sun03Icon : Moon02Icon} size={19} />
	</button>

	{@render railButton('settings', Settings01Icon, { on: 'Close settings', off: 'Settings' })}

	<!--
		The one thing here that keeps a container, because it is not an icon —
		a pair of initials needs something to be a pair of initials *on*.
	-->
	<button
		type="button"
		class={cn(
			'mt-1 flex size-8 items-center justify-center rounded-full text-[0.7rem] font-semibold transition-[background-color,color,transform] duration-150 active:scale-90',
			sidebar.open === 'account'
				? 'bg-accent-ink text-background'
				: 'bg-foreground/8 text-muted-foreground hover:text-foreground'
		)}
		aria-pressed={sidebar.open === 'account'}
		aria-label={sidebar.open === 'account' ? 'Close the account panel' : 'Account'}
		title="Account"
		onclick={() => sidebar.toggle('account')}
	>
		{initials}
	</button>
</nav>
