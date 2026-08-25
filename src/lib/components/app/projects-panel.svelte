<script lang="ts">
	/**
	 * Recent projects, in the sidebar.
	 *
	 * A second control that went to the library was one too many — the mark at
	 * the top of the rail already does that. What is actually wanted mid-task is
	 * to hop from this document to another one without a trip through a page
	 * that shows the same list larger. So the list is here, filtered as you
	 * type, and one click away from any project.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/icon.svelte';
	import {
		FileSpreadsheetIcon,
		Image01Icon,
		Pdf01Icon,
		Search01Icon
	} from '@hugeicons/core-free-icons';
	import { timeAgo } from '$lib/format';
	import { cn } from '$lib/utils';

	interface Entry {
		id: string;
		name: string;
		mimeType: string;
		pageCount: number | null;
		sheetCount: number;
		createdAt: Date | string;
	}

	let { documents }: { documents: Entry[] } = $props();

	let query = $state('');
	let field = $state<HTMLInputElement>();

	// The panel is opened to find something, so it opens ready to be typed
	// into. Selecting rather than just focusing means reopening it and typing
	// replaces the last search instead of appending to it.
	onMount(() => field?.select());

	const here = $derived(page.params.documentId);

	const matches = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return documents;
		return documents.filter((entry) => entry.name.toLowerCase().includes(needle));
	});
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="shrink-0 px-3 pt-3 pb-2">
		<div class="relative">
			<Icon
				icon={Search01Icon}
				size={14}
				class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
			/>
			<input
				bind:this={field}
				type="search"
				bind:value={query}
				placeholder="Search projects"
				aria-label="Search projects"
				class="h-8 w-full rounded-lg border bg-background pr-2.5 pl-8 text-[0.8125rem] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
				onkeydown={(event) => {
					// Type three letters and press Enter. Reaching for the mouse to
					// click the one row you have just filtered down to is the slow
					// half of every quick-open that does not do this.
					if (event.key !== 'Enter' || !matches.length) return;
					event.preventDefault();
					goto(resolve('/(app)/d/[documentId]', { documentId: matches[0].id }));
				}}
			/>
		</div>
	</div>

	<div class="scroll-slim min-h-0 flex-1 overflow-y-auto px-2 pb-3">
		{#if !matches.length}
			<p class="px-2 py-6 text-center text-[0.8125rem] text-muted-foreground">
				{documents.length ? `Nothing matches “${query}”.` : 'No projects yet.'}
			</p>
		{:else}
			<ul class="space-y-0.5">
				{#each matches as entry (entry.id)}
					{@const current = entry.id === here}
					<li>
						<a
							href={resolve('/(app)/d/[documentId]', { documentId: entry.id })}
							aria-current={current ? 'page' : undefined}
							class={cn(
								'flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors',
								current ? 'bg-foreground/6 text-foreground' : 'hover:bg-foreground/4'
							)}
						>
							<Icon
								icon={entry.mimeType === 'application/pdf' ? Pdf01Icon : Image01Icon}
								size={15}
								class={cn('shrink-0', current ? 'text-accent-ink' : 'text-muted-foreground')}
							/>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[0.8125rem] leading-tight font-medium">
									{entry.name}
								</span>
								<span class="mt-0.5 block truncate text-[11px] text-muted-foreground">
									{#if entry.sheetCount}
										{entry.sheetCount}
										{entry.sheetCount === 1 ? 'sheet' : 'sheets'} ·
									{:else if entry.pageCount}
										{entry.pageCount}
										{entry.pageCount === 1 ? 'page' : 'pages'} ·
									{/if}
									{timeAgo(entry.createdAt)}
								</span>
							</span>
							{#if entry.sheetCount}
								<Icon
									icon={FileSpreadsheetIcon}
									size={13}
									class="shrink-0 text-muted-foreground/70"
								/>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
