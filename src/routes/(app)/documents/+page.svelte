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
		ScanImageIcon
	} from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';
	import Dropzone from '$lib/components/app/dropzone.svelte';
	import DocumentDeck from '$lib/components/app/document-deck.svelte';
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

	async function remove(id: string, name: string) {
		const response = await fetch(`/api/documents?id=${id}`, { method: 'DELETE' });
		if (response.ok) {
			toast.success(`Deleted “${name}”`);
			await invalidateAll();
		} else {
			toast.error('Could not delete that document');
		}
	}
</script>

<svelte:head><title>Documents · Rowbot</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-6 py-12">
	<header class="mb-8">
		<h1 class="text-3xl font-semibold tracking-tight">Documents</h1>
		<p class="mt-2 text-muted-foreground">
			Drop in a PDF or a photo of a table. Rowbot reads it, builds the workbook, and shows you how
			it got there.
		</p>
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
		<h2 class="mt-12 mb-5 text-sm font-medium text-muted-foreground">
			{data.documents.length}
			{data.documents.length === 1 ? 'document' : 'documents'}
		</h2>

		<!--
			Each entry is a deck of its own pages rather than a row with a file
			icon. A library of documents should look like the documents: you can
			see at a glance which one is the scanned receipt and which is the
			seven-page report, without reading a single line of metadata.
		-->
		<ul class="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
			{#each data.documents as doc (doc.id)}
				<li class="group relative">
					<a
						href={resolve('/(app)/d/[documentId]', { documentId: doc.id })}
						class="deck block rounded-xl focus-visible:outline-none"
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
							<DropdownMenu.Item variant="destructive" onSelect={() => remove(doc.id, doc.name)}>
								<HugeiconsIcon icon={Delete02Icon} size={16} />
								Delete
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</li>
			{/each}
		</ul>
	{/if}
</div>
