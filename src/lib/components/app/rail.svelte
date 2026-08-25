<script lang="ts">
	/**
	 * The app's only chrome.
	 *
	 * Everything that used to sit along the top of the window lives here now, in
	 * a column fifty-two pixels wide — which is the whole point: a horizontal
	 * bar costs fourteen rems of the one dimension a spreadsheet has least of,
	 * and spends it on four buttons and a breadcrumb. A vertical rail costs a
	 * sliver of the dimension there is plenty of, and the sheet starts at the
	 * top of the screen.
	 *
	 * The rail is only ever icons. Anything that needs words — settings, the
	 * account — opens as the panel beside it.
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import type { IconSvgElement } from '@hugeicons/svelte';
	import {
		Folder01Icon,
		Message01Icon,
		Moon02Icon,
		Settings01Icon,
		Sun03Icon
	} from '@hugeicons/core-free-icons';
	import Logo from '$lib/components/brand/logo.svelte';
	import { theme } from '$lib/theme.svelte';
	import { sidebar, type SidebarPanel } from '$lib/stores/sidebar.svelte';
	import { activity } from '$lib/stores/activity.svelte';
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
			'group relative flex size-9 items-center justify-center rounded-lg transition-colors',
			active
				? 'bg-secondary text-foreground'
				: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
		)}
		aria-pressed={active}
		aria-label={active ? label.on : label.off}
		title={active ? label.on : label.off}
		onclick={() => sidebar.toggle(panel)}
	>
		<!-- A short mark against the rail's edge, the way an active tab is
		     marked in every editor. Cheaper to read at a glance than a fill. -->
		<span
			class={cn(
				'absolute inset-y-1.5 -left-2 w-0.5 rounded-full bg-primary transition-opacity',
				active ? 'opacity-100' : 'opacity-0'
			)}
			aria-hidden="true"
		></span>
		<HugeiconsIcon {icon} size={18} />
	</button>
{/snippet}

<nav
	class="flex w-13 shrink-0 flex-col items-center gap-1 border-r bg-rail py-3"
	aria-label="Rowbot"
>
	<a
		href={resolve('/documents')}
		class="mb-1 flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-accent/60"
		aria-label="Rowbot"
		title="Rowbot"
	>
		<Logo class="size-[22px]" />
	</a>

	<a
		href={resolve('/documents')}
		class={cn(
			'flex size-9 items-center justify-center rounded-lg transition-colors',
			onLibrary
				? 'bg-secondary text-foreground'
				: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
		)}
		aria-current={onLibrary ? 'page' : undefined}
		aria-label="Documents"
		title="Documents"
	>
		<HugeiconsIcon icon={Folder01Icon} size={18} />
	</a>

	{#if isWorkspace}
		<div class="relative">
			{@render railButton('chat', Message01Icon, {
				on: 'Hide the conversation',
				off: 'Show the conversation'
			})}

			<!--
				What the collapsed conversation used to say on a rail of its own:
				that Rowbot is working, and how far through the plan it is. Only
				shown while the panel is hidden — with it open the feed says all of
				this at full size, and a badge over the button is noise.
			-->
			{#if sidebar.open !== 'chat'}
				{#if activity.failed}
					<span
						class="pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-destructive ring-2 ring-rail"
						title="The last run failed"
					></span>
				{:else if activity.busy}
					<span
						class="pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 animate-pulse rounded-full bg-accent-ink ring-2 ring-rail"
						title={activity.total
							? `Working · ${activity.done} of ${activity.total} steps done`
							: 'Rowbot is working'}
					></span>
				{/if}

				{#if activity.total > 0}
					<span
						class="pointer-events-none mt-1 block text-center text-[10px] leading-none font-medium text-muted-foreground tabular-nums"
						title="{activity.done} of {activity.total} plan steps done"
					>
						{activity.done}/{activity.total}
					</span>
				{/if}
			{/if}
		</div>
	{/if}

	<div class="flex-1"></div>

	<button
		type="button"
		class="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
		onclick={() => theme.toggle()}
		aria-label={theme.current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
		title={theme.current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
	>
		<HugeiconsIcon icon={theme.current === 'dark' ? Sun03Icon : Moon02Icon} size={18} />
	</button>

	{@render railButton('settings', Settings01Icon, { on: 'Close settings', off: 'Settings' })}

	<button
		type="button"
		class={cn(
			'relative mt-1 flex size-9 items-center justify-center rounded-full text-[0.8125rem] font-semibold transition-colors',
			sidebar.open === 'account'
				? 'bg-primary text-primary-foreground'
				: 'bg-secondary text-secondary-foreground hover:bg-accent'
		)}
		aria-pressed={sidebar.open === 'account'}
		aria-label={sidebar.open === 'account' ? 'Close the account panel' : 'Account'}
		title="Account"
		onclick={() => sidebar.toggle('account')}
	>
		{initials}
	</button>
</nav>
