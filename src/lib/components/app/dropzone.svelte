<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/icon.svelte';
	import { CloudUploadIcon, Key01Icon, Loading03Icon } from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { ACCEPTED_MIME_TYPES, prettySize, rejectionReason, MAX_UPLOAD_BYTES } from '$lib/uploads';
	import { cn } from '$lib/utils';

	let { class: className }: { class?: string } = $props();

	const allowance = $derived(page.data.allowance);
	/** True once the account has used every document its tier permits. */
	const exhausted = $derived(
		allowance?.documents.limit !== null && allowance?.documents.used >= allowance?.documents.limit
	);
	const pageLimit = $derived(allowance?.pageLimit ?? null);

	let dragging = $state(false);
	let uploading = $state(false);
	let outOfAllowance = $state(false);
	let input = $state<HTMLInputElement | null>(null);

	const ACCEPT = ACCEPTED_MIME_TYPES.join(',');

	/**
	 * Turn away what the server would turn away, before spending the upload on
	 * it. A 40 MB file used to travel the whole way before being refused.
	 */
	function offer(file: File | undefined, extras = 0) {
		if (!file) return;
		const reason = rejectionReason(file);
		if (reason) {
			toast.error('Rowbot cannot read that file', { description: reason });
			return;
		}
		if (extras > 0) {
			toast.info(`Taking “${file.name}”`, {
				description: `One document at a time — the other ${extras === 1 ? 'file was' : `${extras} files were`} left alone.`
			});
		}
		upload(file);
	}

	async function upload(file: File) {
		uploading = true;
		try {
			const body = new FormData();
			body.set('file', file);
			const response = await fetch('/api/documents', { method: 'POST', body });

			if (!response.ok) {
				// 402 is the allowance talking, not a broken upload.
				outOfAllowance = response.status === 402;
				const detail = await response.json().catch(() => null);
				throw new Error(detail?.message ?? `Upload failed (${response.status}).`);
			}

			const { document } = await response.json();
			// Straight into the workspace — the agent starts as soon as it loads.
			await goto(resolve('/(app)/d/[documentId]', { documentId: document.id }));
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : undefined;
			toast.error('Could not upload that file', {
				description: message,
				// A spent allowance is not a failure to retry — it is a thing to go
				// and fix, so the toast carries the way to fix it.
				action: outOfAllowance
					? { label: 'Open Settings', onClick: () => goto(resolve('/settings')) }
					: undefined,
				duration: outOfAllowance ? 10000 : 5000
			});
			uploading = false;
			outOfAllowance = false;
		}
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		const files = event.dataTransfer?.files;
		offer(files?.[0], Math.max((files?.length ?? 0) - 1, 0));
	}
</script>

{#if exhausted}
	<div
		class={cn(
			'flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-8 py-14 text-center',
			className
		)}
	>
		<span
			class="flex size-14 items-center justify-center rounded-2xl border bg-card text-muted-foreground shadow-sm"
		>
			<Icon icon={Key01Icon} size={26} />
		</span>
		<div class="space-y-1.5">
			<p class="font-medium">You have used your free document</p>
			<p class="mx-auto max-w-md text-sm text-muted-foreground">
				Rowbot runs on my own OpenAI and Mistral keys, so the free tier is one document. Add your
				own keys and the limits come off — you will be spending your own credit.
			</p>
		</div>
		<Button href={resolve('/settings')} variant="outline" size="sm">Add your API keys</Button>
	</div>
{:else}
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
		onclick={() => input?.click()}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				input?.click();
			}
		}}
	>
		<!--
			Hidden from the tab order and from assistive technology on purpose. The
			drop zone around it is the control — it carries the role, the label and
			the key handling — and a focusable descendant inside a `role="button"`
			would give a screen-reader user two stops for one action, the second of
			them unlabelled. This element exists only so a click can open the file
			picker, which is the one thing script cannot do on its own.
		-->
		<input
			bind:this={input}
			type="file"
			accept={ACCEPT}
			class="sr-only"
			tabindex="-1"
			aria-hidden="true"
			onchange={(e) => {
				offer(e.currentTarget.files?.[0]);
				e.currentTarget.value = '';
			}}
		/>

		<span
			class={cn(
				'flex size-14 items-center justify-center rounded-2xl border bg-card text-accent-ink shadow-sm transition-transform',
				dragging ? 'scale-110' : 'group-hover:scale-105'
			)}
		>
			<Icon
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
			<p class="text-sm text-muted-foreground">
				PDF, PNG, JPEG, WebP or TIFF · up to {prettySize(MAX_UPLOAD_BYTES)}{#if pageLimit}
					· {pageLimit} pages{/if}
			</p>
		</div>
	</div>
{/if}
