<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		CheckmarkBadge01Icon,
		Delete02Icon,
		FileSpreadsheetIcon,
		Image01Icon,
		More01Icon,
		Pdf01Icon,
		ScanImageIcon,
		Search01Icon
	} from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';
	import Dropzone from '$lib/components/app/dropzone.svelte';
	import DocumentDeck from '$lib/components/app/document-deck.svelte';
	import Logo from '$lib/components/brand/logo.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { fileSize, timeAgo } from '$lib/format';
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
		if (!needle) return data.documents;
		return data.documents.filter(
			(doc) =>
				doc.name.toLowerCase().includes(needle) ||
				doc.originalFilename.toLowerCase().includes(needle)
		);
	});

	/** A line of arithmetic about the library, for the header to say something true. */
	const tally = $derived.by(() => {
		const docs = data.documents.length;
		const sheets = data.documents.reduce((total, doc) => total + doc.sheetCount, 0);
		const pages = data.documents.reduce((total, doc) => total + (doc.pageCount ?? 0), 0);
		return { docs, sheets, pages };
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
			toast.success(`Deleted “${name}”`);
			await invalidateAll();
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head><title>Documents · Rowbot</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-6 py-10">
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
			<dl class="flex shrink-0 items-center gap-6 text-sm">
				{#each [{ label: tally.docs === 1 ? 'project' : 'projects', value: tally.docs }, { label: tally.pages === 1 ? 'page read' : 'pages read', value: tally.pages }, { label: tally.sheets === 1 ? 'sheet built' : 'sheets built', value: tally.sheets }] as stat (stat.label)}
					<div>
						<dd class="text-2xl font-semibold tracking-tight tabular-nums">{stat.value}</dd>
						<dt class="mt-0.5 text-xs text-muted-foreground">{stat.label}</dt>
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
							<HugeiconsIcon icon={step.icon} size={15} />
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
			<h2 class="text-sm font-medium text-muted-foreground">
				{#if query.trim()}
					{matches.length}
					{matches.length === 1 ? 'match' : 'matches'} for “{query.trim()}”
				{:else}
					{data.documents.length}
					{data.documents.length === 1 ? 'project' : 'projects'}
				{/if}
			</h2>

			<div class="relative w-full sm:w-64">
				<HugeiconsIcon
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
			<ul class="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
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
								<p
									class="truncate text-sm font-medium transition-colors group-focus-within:text-accent-ink group-hover:text-accent-ink"
								>
									{doc.name}
								</p>
								<p class="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
									<HugeiconsIcon
										icon={doc.mimeType === 'application/pdf' ? Pdf01Icon : Image01Icon}
										size={12}
										class="shrink-0"
									/>
									{#if doc.pageCount}
										{doc.pageCount}
										{doc.pageCount === 1 ? 'page' : 'pages'} ·
									{/if}
									{fileSize(doc.sizeBytes)} · {timeAgo(doc.createdAt)}
								</p>
							</div>
						</a>

						<!-- Status rides on the deck itself, where the eye already is. -->
						{#if doc.sheetCount}
							<span
								class="pointer-events-none absolute top-1 right-1 flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-sm ring-1 ring-border backdrop-blur-sm"
							>
								<HugeiconsIcon icon={FileSpreadsheetIcon} size={11} class="text-accent-ink" />
								{doc.sheetCount}
							</span>
						{:else if doc.status === 'pending'}
							<span
								class="pointer-events-none absolute top-1 right-1 rounded-full bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm"
							>
								Not started
							</span>
						{/if}

						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<button
										{...props}
										class="absolute top-1 left-1 flex size-7 items-center justify-center rounded-md bg-background/90 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border backdrop-blur-sm transition group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
										aria-label="Actions for {doc.name}"
									>
										<HugeiconsIcon icon={More01Icon} size={15} />
									</button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start">
								<DropdownMenu.Item
									variant="destructive"
									onSelect={() =>
										(pending = { id: doc.id, name: doc.name, sheets: doc.sheetCount ?? 0 })}
								>
									<HugeiconsIcon icon={Delete02Icon} size={16} />
									Delete
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
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
