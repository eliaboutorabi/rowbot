<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { invalidate } from '$app/navigation';
	import Icon from '$lib/components/ui/icon.svelte';
	import {
		CheckmarkBadge01Icon,
		Delete02Icon,
		FileSpreadsheetIcon,
		Image01Icon,
		ArrowDataTransferVerticalIcon,
		Pdf01Icon,
		ScanImageIcon,
		Search01Icon,
		Tick02Icon
	} from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';
	import Dropzone from '$lib/components/app/dropzone.svelte';
	import DocumentDeck from '$lib/components/app/document-deck.svelte';
	import Logo from '$lib/components/brand/logo.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { secondaryName, timeAgo } from '$lib/format';
	import { LIBRARY } from '$lib/library-data';
	import { forgetThumbnail } from '$lib/thumbnail-cache';
	import { isSortKey, SORTS, sortDocuments, type SortKey } from '$lib/sort-documents';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** The pipeline, in order — which doubles as an explanation of the product. */
	const STEPS = [
		{
			icon: ScanImageIcon,
			title: 'It reads the page',
			body: 'OCR finds every table, header and footnote, and keeps track of where on the page each one came from.'
		},
		{
			icon: FileSpreadsheetIcon,
			title: 'It builds the workbook',
			body: 'One sheet per table, stitched back together when a table runs across a page break.'
		},
		{
			icon: CheckmarkBadge01Icon,
			title: 'It checks its work',
			body: 'Totals become real formulas, and anything that does not reconcile is flagged for you rather than quietly fixed.'
		}
	];

	let query = $state('');

	const matches = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		const found = !needle
			? data.documents
			: data.documents.filter(
					(doc) =>
						doc.title?.toLowerCase().includes(needle) ||
						doc.name.toLowerCase().includes(needle) ||
						doc.originalFilename.toLowerCase().includes(needle)
				);

		return sortDocuments(found, sort);
	});

	/**
	 * How the grid is ordered. The comparators live in `sort-documents.ts`,
	 * where they can be tested; this only remembers the choice.
	 *
	 * Defaults to what was last worked on. A library you are in the middle of
	 * is ordered by where you left off, not by when the files happened to
	 * arrive — which is also why the row of recent conversations that used to
	 * sit above the grid is gone: the grid can simply be in that order.
	 *
	 * Kept in local storage: whichever of carrying on, adding or hunting for a
	 * name somebody is doing, they are usually still doing it tomorrow.
	 */
	let sort = $state<SortKey>('modified');

	onMount(() => {
		const held = localStorage.getItem('rowbot:sort');
		if (isSortKey(held)) sort = held;
	});

	function reorder(key: SortKey) {
		sort = key;
		try {
			localStorage.setItem('rowbot:sort', key);
		} catch {
			// Private browsing refuses writes; the order just will not persist.
		}
	}

	const sortLabel = $derived(
		SORTS.find((option) => option.key === sort)?.label ?? 'Last worked on'
	);

	const tally = $derived.by(() => {
		const docs = data.documents.length;
		const sheets = data.documents.reduce((total, doc) => total + doc.sheetCount, 0);
		return { docs, sheets };
	});

	/**
	 * Deleting takes the page, the workbook and the conversation with it, and
	 * none of it comes back — so it asks first, and says what goes. The menu
	 * item that starts this sits one click from an ordinary open, which is
	 * exactly the arrangement that produces accidents.
	 */
	let pending = $state<{ id: string; name: string; sheets: number } | null>(null);
	let deleting = $state(false);

	async function confirmRemove() {
		if (!pending || deleting) return;
		const { id, name } = pending;
		deleting = true;
		try {
			const response = await fetch(`/api/documents?id=${id}`, { method: 'DELETE' });
			if (!response.ok) {
				toast.error('Could not delete that document');
				return;
			}
			pending = null;
			// The picture of a document that no longer exists is not worth keeping.
			void forgetThumbnail(id);
			toast.success(`Deleted “${name}”`);
			await invalidate(LIBRARY);
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head><title>Documents · Rowbot</title></svelte:head>

<div class="relative">
	<!--
		The same wash the landing page opens with, so arriving here from there
		does not feel like arriving at a different product. Behind everything and
		clipped only at its own foot, so it reaches the top of the scroller.
	-->
	<div
		class="pointer-events-none absolute inset-x-0 top-0 h-[30rem] overflow-hidden"
		aria-hidden="true"
	>
		<div
			class="absolute top-[-18rem] left-1/2 size-[46rem] -translate-x-1/2 rounded-full bg-primary/8 blur-3xl dark:bg-primary/14"
		></div>
		<div
			class="absolute top-[-12rem] left-[78%] size-[24rem] -translate-x-1/2 rounded-full bg-chart-2/8 blur-3xl"
		></div>
	</div>

	<div class="relative mx-auto w-full max-w-6xl px-6 py-10">
		<!-- ── Masthead ────────────────────────────────────────────────────
	     The library is where the app introduces itself. It used to open on
	     the word "Documents" and nothing else — no mark, no sentence saying
	     what any of this is for, which is a strange welcome for the page you
	     land on. -->
		<header class="mb-9 flex flex-wrap items-end justify-between gap-6">
			<div class="min-w-0">
				<div class="flex items-center gap-3">
					<Logo class="size-9" />
					<h1 class="text-3xl font-semibold tracking-tight">
						Row<span class="text-accent-ink">bot</span>
					</h1>
				</div>
				<p class="mt-3 max-w-xl leading-relaxed text-muted-foreground">
					Turns the tables inside a PDF or a photograph into a spreadsheet you can trust — and shows
					you every judgement it made getting there.
				</p>
			</div>

			{#if tally.docs}
				<dl
					class="flex shrink-0 items-center divide-x divide-border rounded-xl border bg-card/60 backdrop-blur-sm"
				>
					{#each [{ label: tally.docs === 1 ? 'project' : 'projects', value: tally.docs }, { label: tally.sheets === 1 ? 'sheet built' : 'sheets built', value: tally.sheets }] as stat (stat.label)}
						<div class="px-5 py-2.5 text-center">
							<dd class="text-2xl leading-none font-semibold tracking-tight tabular-nums">
								{stat.value}
							</dd>
							<dt class="mt-1.5 text-xs text-muted-foreground">{stat.label}</dt>
						</div>
					{/each}
				</dl>
			{/if}
		</header>

		<Dropzone />

		{#if !data.documents.length}
			<!--
			An empty library is the one screen every new account sees, so it says
			what happens next rather than "No documents yet".
		-->
			<div class="mt-12 border-t pt-10">
				<h2 class="text-sm font-medium">Nothing here yet — here is what happens when there is</h2>
				<ol class="mt-5 grid gap-5 sm:grid-cols-3">
					{#each STEPS as step, i (step.title)}
						<li class="flex gap-3">
							<span
								class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground"
							>
								<Icon icon={step.icon} size={15} />
							</span>
							<div class="min-w-0">
								<p class="text-sm font-medium">
									<span class="text-muted-foreground tabular-nums">{i + 1}.</span>
									{step.title}
								</p>
								<p class="mt-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
							</div>
						</li>
					{/each}
				</ol>
			</div>
		{:else}
			<div class="mt-11 mb-5 flex flex-wrap items-center justify-between gap-3">
				<h2 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					{#if query.trim()}
						{matches.length}
						{matches.length === 1 ? 'match' : 'matches'} for “{query.trim()}”
					{:else}
						{data.documents.length}
						{data.documents.length === 1 ? 'project' : 'projects'}
					{/if}
				</h2>

				<div class="flex w-full items-center gap-2 sm:w-auto">
					<div class="relative w-full sm:w-64">
						<Icon
							icon={Search01Icon}
							size={15}
							class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
						/>
						<input
							type="search"
							bind:value={query}
							placeholder="Search projects"
							aria-label="Search projects"
							class="h-9 w-full rounded-lg border bg-card pr-3 pl-9 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
						/>
					</div>

					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							class="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:border-ring focus-visible:outline-none"
							aria-label="Sort projects. Currently {sortLabel.toLowerCase()}."
						>
							<Icon icon={ArrowDataTransferVerticalIcon} size={15} />
							<span class="hidden sm:inline">{sortLabel}</span>
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="w-44">
							{#each SORTS as option (option.key)}
								<DropdownMenu.Item onclick={() => reorder(option.key)} class="justify-between">
									{option.label}
									{#if sort === option.key}
										<Icon icon={Tick02Icon} size={14} class="text-accent-ink" />
									{/if}
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			</div>

			{#if !matches.length}
				<p class="rounded-xl border border-dashed py-14 text-center text-sm text-muted-foreground">
					Nothing here is called “{query.trim()}”.
				</p>
			{:else}
				<!--
				Each entry is a deck of its own pages rather than a row with a file
				icon. A library of documents should look like the documents: you can
				see at a glance which one is the scanned receipt and which is the
				seven-page report, without reading a single line of metadata.
			-->
				<ul
					class="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
				>
					{#each matches as doc (doc.id)}
						<li class="group relative">
							<a
								href={resolve('/(app)/d/[documentId]', { documentId: doc.id })}
								class="deck block rounded-xl transition-transform duration-200 group-hover:-translate-y-0.5 focus-visible:outline-none"
								aria-label={doc.name}
							>
								<DocumentDeck
									documentId={doc.id}
									mimeType={doc.mimeType}
									pageCount={doc.pageCount}
									name={doc.name}
								/>

								<div class="mt-1 px-1">
									<!-- What the agent read off the page, when it got that far. The
								     filename is what somebody saved it under and says nothing
								     about what is inside; it keeps the line below, because that
								     is still how you find the thing you uploaded. -->
									<p
										class="truncate text-sm font-medium transition-colors group-focus-within:text-accent-ink group-hover:text-accent-ink"
										title={doc.title ?? doc.name}
									>
										{doc.title ?? doc.name}
									</p>
									<p
										class="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground"
									>
										<Icon
											icon={doc.mimeType === 'application/pdf' ? Pdf01Icon : Image01Icon}
											size={12}
											class="shrink-0"
										/>
										{#if secondaryName(doc.title, doc.name)}
											<span class="truncate">{doc.name}</span> ·
										{/if}
										<!-- No page count. The deck already shows how thick the
									     document is, which is the only thing the number was
									     telling you and it says it without being read.

									     The time follows the sort. A grid ordered by when each
									     project was last worked on, with the date it was uploaded
									     under every card, looks like a grid in no order at all. -->
										{timeAgo(
											sort === 'modified'
												? (doc.conversation?.lastActiveAt ?? doc.createdAt)
												: doc.createdAt
										)}
									</p>
								</div>
							</a>

							<!--
							No sheet count. It rode on the corner of every finished deck
							saying a number nobody needed — how many sheets a workbook has
							is a thing you find out by opening it, and a badge on every
							single card is not a status, it is wallpaper.

							"Not started" stays: that one is the exception rather than the
							rule, and it is the only state where the answer changes what
							you would do next.
						-->
							{#if doc.status === 'pending' && !doc.sheetCount}
								<span
									class="pointer-events-none absolute top-1 right-1 rounded-full bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm"
								>
									Not started
								</span>
							{/if}

							<!--
								Delete, at the foot of the deck.

								It was a dots menu in the top corner, which put it under the
								"Not started" badge on exactly the documents most likely to be
								thrown away. There is only one action behind it, so a menu was
								a click of ceremony around a single button — and a bin says
								what it does without being opened.

								The box is the deck's own aspect ratio, so "bottom" means the
								bottom of the paper rather than the bottom of the caption
								underneath it. It is a sibling of the link, not a child, so
								pressing it cannot also open the document.
							-->
							<div
								class="pointer-events-none absolute inset-x-0 top-0"
								style="aspect-ratio: 1 / 0.83"
							>
								<button
									type="button"
									class="pointer-events-auto absolute right-1 bottom-1 flex size-7 items-center justify-center rounded-md bg-background/90 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border backdrop-blur-sm transition group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40"
									aria-label="Delete {doc.title ?? doc.name}"
									title="Delete"
									onclick={() =>
										(pending = { id: doc.id, name: doc.name, sheets: doc.sheetCount ?? 0 })}
								>
									<Icon icon={Delete02Icon} size={15} />
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</div>

<Dialog.Root
	open={pending !== null}
	onOpenChange={(next) => {
		if (!next && !deleting) pending = null;
	}}
>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Delete “{pending?.name}”?</Dialog.Title>
			<Dialog.Description>
				{#if pending?.sheets}
					This removes the original file, the {pending.sheets}-sheet workbook Rowbot built from it,
					and the conversation about it. It cannot be undone.
				{:else}
					This removes the original file and everything Rowbot recorded about it. It cannot be
					undone.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" disabled={deleting} onclick={() => (pending = null)}>Keep it</Button
			>
			<Button variant="destructive" disabled={deleting} onclick={confirmRemove}>
				{deleting ? 'Deleting…' : 'Delete for good'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
