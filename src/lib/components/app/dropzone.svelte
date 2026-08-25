<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { CloudUploadIcon, Loading03Icon } from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';
	import { cn } from '$lib/utils';

	let { class: className }: { class?: string } = $props();

	let dragging = $state(false);
	let uploading = $state(false);
	let input: HTMLInputElement;

	const ACCEPT =
		'application/pdf,image/png,image/jpeg,image/webp,image/gif,image/tiff,image/bmp,image/avif';

	async function upload(file: File) {
		uploading = true;
		try {
			const body = new FormData();
			body.set('file', file);
			const response = await fetch('/api/documents', { method: 'POST', body });

			if (!response.ok) {
				const detail = await response.json().catch(() => null);
				throw new Error(detail?.message ?? `Upload failed (${response.status}).`);
			}

			const { document } = await response.json();
			// Straight into the workspace — the agent starts as soon as it loads.
			await goto(resolve('/(app)/d/[documentId]', { documentId: document.id }));
		} catch (cause) {
			toast.error('Could not upload that file', {
				description: cause instanceof Error ? cause.message : undefined
			});
			uploading = false;
		}
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		const file = event.dataTransfer?.files?.[0];
		if (file) upload(file);
	}
</script>

<div
	role="button"
	tabindex="0"
	aria-label="Upload a PDF or image"
	aria-busy={uploading}
	class={cn(
		'group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-14 text-center transition-colors',
		dragging
			? 'border-primary bg-primary/5'
			: 'border-border hover:border-primary/50 hover:bg-accent/40',
		uploading && 'pointer-events-none opacity-70',
		className
	)}
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={handleDrop}
	onclick={() => input.click()}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			input.click();
		}
	}}
>
	<input
		bind:this={input}
		type="file"
		accept={ACCEPT}
		class="sr-only"
		onchange={(e) => {
			const file = e.currentTarget.files?.[0];
			if (file) upload(file);
			e.currentTarget.value = '';
		}}
	/>

	<span
		class={cn(
			'flex size-14 items-center justify-center rounded-2xl border bg-card text-primary shadow-sm transition-transform',
			dragging ? 'scale-110' : 'group-hover:scale-105'
		)}
	>
		<HugeiconsIcon
			icon={uploading ? Loading03Icon : CloudUploadIcon}
			size={26}
			class={uploading ? 'animate-spin' : ''}
		/>
	</span>

	<div class="space-y-1.5">
		<p class="font-medium">
			{#if uploading}
				Uploading…
			{:else if dragging}
				Drop it here
			{:else}
				Drop a document, or click to browse
			{/if}
		</p>
		<p class="text-sm text-muted-foreground">PDF, PNG, JPEG, WebP or TIFF · up to 25 MB</p>
	</div>
</div>
