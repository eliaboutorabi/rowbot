<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Delete02Icon,
		FileSpreadsheetIcon,
		Image01Icon,
		More01Icon,
		Pdf01Icon
	} from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';
	import Dropzone from '$lib/components/app/dropzone.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { fileSize, timeAgo } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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

<div class="mx-auto w-full max-w-5xl px-6 py-12">
	<header class="mb-8">
		<h1 class="text-3xl font-semibold tracking-tight">Documents</h1>
		<p class="mt-2 text-muted-foreground">
			Drop in a PDF or a photo of a table. Rowbot reads it, builds the workbook, and shows you how
			it got there.
		</p>
	</header>

	<Dropzone />

	{#if data.documents.length}
		<h2 class="mt-12 mb-3 text-sm font-medium text-muted-foreground">
			{data.documents.length}
			{data.documents.length === 1 ? 'document' : 'documents'}
		</h2>

		<ul class="divide-y overflow-hidden rounded-xl border bg-card">
			{#each data.documents as doc (doc.id)}
				<li
					class="group relative flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-accent/50"
				>
					<span
						class="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"
					>
						<HugeiconsIcon
							icon={doc.mimeType === 'application/pdf' ? Pdf01Icon : Image01Icon}
							size={18}
						/>
					</span>

					<div class="min-w-0 flex-1">
						<a
							href={resolve('/(app)/d/[documentId]', { documentId: doc.id })}
							class="block truncate font-medium after:absolute after:inset-0"
						>
							{doc.name}
						</a>
						<p class="mt-0.5 truncate text-xs text-muted-foreground">
							{fileSize(doc.sizeBytes)}
							{#if doc.pageCount}· {doc.pageCount} {doc.pageCount === 1 ? 'page' : 'pages'}{/if}
							· {timeAgo(doc.createdAt)}
						</p>
					</div>

					{#if doc.sheetCount}
						<Badge variant="secondary" class="relative gap-1.5">
							<HugeiconsIcon icon={FileSpreadsheetIcon} size={13} />
							{doc.sheetCount}
							{doc.sheetCount === 1 ? 'sheet' : 'sheets'}
						</Badge>
					{:else if doc.status === 'pending'}
						<Badge variant="outline" class="relative">Not started</Badge>
					{/if}

					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<button
									{...props}
									class="relative flex size-8 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
									aria-label="Actions for {doc.name}"
								>
									<HugeiconsIcon icon={More01Icon} size={16} />
								</button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
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
