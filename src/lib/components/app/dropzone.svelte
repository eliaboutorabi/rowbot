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
			/*
			 * A well rather than a card: lighter than the page in light, darker in
			 * dark, so it reads as somewhere to put something into rather than
			 * another panel sitting on top. The border is drawn as an SVG below,
			 * not by `border-dashed` — CSS gives no control over how long a dash
			 * is or where it starts, and both are the whole effect here.
			 */
			'group relative flex cursor-pointer flex-col items-center justify-center gap-3.5 rounded-2xl px-8 py-10 text-center transition-colors',
			dragging
				? 'bg-primary/[0.07]'
				: 'bg-gradient-to-b from-white/70 to-white/30 hover:from-primary/[0.05] dark:from-black/30 dark:to-black/10',
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
		<!--
			The border, and the ants.

			`stroke-dasharray` says how long a dash is and how far apart they sit,
			which no CSS border can; animating `stroke-dashoffset` walks them round
			the edge. The rectangle's geometry comes from CSS rather than
			attributes so it can be inset by exactly half the stroke — otherwise
			the outer half of the line falls outside the box and the corners look
			clipped.
		-->
		<svg class="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
			<rect
				class={cn('ants', dragging && 'ants-eager')}
				fill="none"
				stroke="currentColor"
				stroke-width="1.75"
				stroke-dasharray="9 9"
				stroke-linecap="round"
			/>
		</svg>

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
				'flex size-12 items-center justify-center rounded-2xl bg-primary/[0.08] text-accent-ink ring-1 ring-primary/15 transition-transform dark:bg-primary/15 dark:ring-primary/25',
				dragging ? 'scale-110' : 'group-hover:scale-105'
			)}
		>
			<Icon
				icon={uploading ? Loading03Icon : CloudUploadIcon}
				size={22}
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

<style>
	.ants {
		/* Geometry as CSS properties, which SVG2 allows and which lets the rect
		   inset itself by half a stroke without hard-coding the box size. */
		x: 0.75px;
		y: 0.75px;
		width: calc(100% - 1.5px);
		height: calc(100% - 1.5px);
		rx: 15px;
		ry: 15px;
		/* `--border` is a hairline colour, drawn to disappear. These dashes are
		   the invitation, so they sit well above it in both themes. */
		color: color-mix(in oklab, var(--foreground) 30%, transparent);
		animation: ants 12s linear infinite;
	}

	/* Faster and in the accent the moment something is over the box, so the
	   border answers the drag before the drop lands. */
	.ants-eager {
		color: var(--primary);
		animation-duration: 2.4s;
	}

	@keyframes ants {
		to {
			stroke-dashoffset: -180;
		}
	}

	:global(.group:hover) .ants {
		color: color-mix(in oklab, var(--primary) 55%, transparent);
	}

	@media (prefers-reduced-motion: reduce) {
		.ants {
			animation: none;
		}
	}
</style>
