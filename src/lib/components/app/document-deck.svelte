<script lang="ts">
	/**
	 * A document rendered as a deck of its own pages.
	 *
	 * The stack is not z-index and not 3D. Every page occupies the same box and
	 * is rotated about a shared pivot at the bottom centre by a multiple of one
	 * custom property, so a single value on the parent re-poses the whole fan.
	 * DOM order does the stacking — the back page is written first — and each
	 * page further back is dimmed slightly, which is the cheap trick that makes
	 * five rectangles read as a stack with thickness rather than five stickers.
	 *
	 * Pages render only when the card approaches the viewport. A library of
	 * twenty documents should not decode a hundred PDF pages on load.
	 */
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/icon.svelte';
	import { Pdf01Icon } from '@hugeicons/core-free-icons';
	import { openDocument, renderPage } from '$lib/pdf';
	import { readThumbnail, writeThumbnail } from '$lib/thumbnail-cache';

	let {
		documentId,
		mimeType,
		pageCount,
		name
	}: {
		documentId: string;
		mimeType: string;
		pageCount: number | null;
		name: string;
	} = $props();

	const isImage = $derived(mimeType.startsWith('image/'));

	/** Never fake pages the document does not have — a one-page file is one card. */
	const MAX_CARDS = 5;
	const cards = $derived(Math.max(1, Math.min(pageCount ?? 1, MAX_CARDS)));

	/** Backing-store size for one card, before device pixel ratio. */
	const CARD_W = 150;
	const CARD_H = 200;

	let root = $state<HTMLElement>();
	/** True once a render has failed, so the card shows a mark instead of blank paper. */
	let failed = $state(false);
	/** Until the top page is on screen the deck is blank paper, and says so quietly. */
	let ready = $state(false);
	const canvases = $state<HTMLCanvasElement[]>([]);
	let drawn = false;

	/** Paint a stored thumbnail straight onto the top card. */
	async function paint(canvas: HTMLCanvasElement, blob: Blob) {
		const bitmap = await createImageBitmap(blob);
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.drawImage(bitmap, 0, 0);
		bitmap.close();
	}

	async function render() {
		if (drawn || isImage) return;
		drawn = true;

		const canvas = canvases[0];
		if (!canvas) return;

		/*
		 * The stored copy first. Fetching the PDF and running pdf.js over it to
		 * produce a picture this size is most of a second, and it was happening
		 * on every visit to the library — the grid would appear and the pages
		 * would follow a beat later, which looks like a page that has not
		 * finished loading.
		 */
		const stored = await readThumbnail(documentId);
		if (stored) {
			try {
				await paint(canvas, stored);
				ready = true;
				return;
			} catch {
				// A blob that will not decode is a blob worth replacing.
			}
		}

		try {
			const pdf = await openDocument(`/api/source/${documentId}`);

			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			const width = CARD_W * ratio;
			const height = CARD_H * ratio;

			/*
			 * Only the top page is drawn. The cards behind it are rotated a few
			 * degrees and show a sliver of edge each — never enough to read a word
			 * of — so rendering four more pages per document was four fifths of
			 * the work for none of the picture. They stay blank paper, which is
			 * what a sliver of a page looks like anyway.
			 */
			const page = await pdf.getPage(1);
			const unscaled = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: width / unscaled.width });

			// Fit the width, then keep the top of the page. A cover crop from the
			// centre would slice the header off every thumbnail, and the header
			// is the part that identifies the page.
			const offscreen = document.createElement('canvas');
			offscreen.width = viewport.width;
			offscreen.height = viewport.height;
			const offContext = offscreen.getContext('2d');
			if (!offContext) return;
			offContext.fillStyle = '#ffffff';
			offContext.fillRect(0, 0, offscreen.width, offscreen.height);
			await renderPage(page, offscreen, offContext, viewport);

			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext('2d');
			if (!context) return;
			context.fillStyle = '#ffffff';
			context.fillRect(0, 0, width, height);
			context.drawImage(
				offscreen,
				0,
				0,
				width,
				Math.min(height, offscreen.height),
				0,
				0,
				width,
				Math.min(height, offscreen.height)
			);
			ready = true;

			// Kept for next time. JPEG rather than PNG: this is a photograph of a
			// page, and the difference on twenty of them is megabytes.
			canvas.toBlob(
				(blob) => {
					if (blob) void writeThumbnail(documentId, blob);
				},
				'image/jpeg',
				0.82
			);
		} catch (cause) {
			// A thumbnail is decoration and must never break the library — but a
			// silent failure here is a blank white card, which reads as an empty
			// document rather than a broken preview. Say so, and leave a trail.
			console.error(`Could not draw a preview of “${name}”`, cause);
			failed = true;
		}
	}

	onMount(() => {
		if (isImage || !root) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					render();
					observer.disconnect();
				}
			},
			{ rootMargin: '1200px 0px' }
		);
		observer.observe(root);
		return () => observer.disconnect();
	});
</script>

<div bind:this={root} class="deck-fan" style:--n={cards}>
	{#if isImage}
		<img
			class="deck-page"
			style:--i={0}
			src={`/api/source/${documentId}`}
			alt={`First page of ${name}`}
			loading="lazy"
		/>
	{:else}
		<!-- Back page first: DOM order is the stacking order, no z-index needed. -->
		{#each Array.from({ length: cards }, (_, i) => cards - 1 - i) as index (index)}
			<canvas
				bind:this={canvases[index]}
				class="deck-page {index === 0 && !ready && !failed ? 'deck-waiting' : ''}"
				style:--i={index}
				width={CARD_W}
				height={CARD_H}
				aria-hidden={index > 0 ? 'true' : undefined}
				aria-label={index === 0 ? `First page of ${name}` : undefined}
			></canvas>
		{/each}
	{/if}

	{#if failed}
		<span
			class="pointer-events-none absolute inset-0 flex items-center justify-center text-neutral-400"
			title="This preview could not be drawn"
		>
			<Icon icon={Pdf01Icon} size={26} />
		</span>
	{/if}
</div>

<style>
	.deck-fan {
		position: relative;
		/* Room for the widest swing: the outer pages dip below the pivot and
		   rise above the middle page, and this is exactly that envelope. */
		aspect-ratio: 1 / 0.83;
	}

	/* While the top page is still being drawn the card is blank paper with a
	   breath in it, so the moment the page lands reads as a thing finishing
	   rather than a thing appearing out of nowhere. */
	.deck-waiting {
		animation: deck-waiting 1.6s ease-in-out infinite;
	}

	@keyframes deck-waiting {
		0%,
		100% {
			background: #fff;
		}
		50% {
			background: #f1f0ee;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.deck-waiting {
			animation: none;
		}
	}

	.deck-page {
		position: absolute;
		left: 24%;
		bottom: 10.7%;
		width: 52%;
		aspect-ratio: 3 / 4;
		object-fit: cover;
		object-position: top center;
		background: #fff;
		/* Rounder than paper, because these are not photographs of paper —
		   they are cards, and every other card in the app is round. */
		border-radius: 10px;
		/* Carries the rim that does most of the separating now that the shadow
		   has been cut back: one hairline per page rather than five stacked
		   copies of an eighteen-pixel blur. */
		box-shadow: var(--deck-rim, none);

		transform-origin: 50% 100%;
		transform: rotate(calc((var(--i) - (var(--n) - 1) / 2) * var(--fan, 5deg)));

		/* The shadow goes last in the chain. Anything after it gets filtered too,
		   which rings every page in a halo.

		   No per-card dimming. Each page used to come down a few percent for
		   every step further back, which was meant to read as depth and read
		   instead as a stack going grey towards the bottom — paper does not do
		   that. The rim and the shadow separate them; nothing else needs to.
		   `--deck-paper` stays, because it takes every page down by the same
		   amount and only in dark mode, where a grid of pure white rectangles
		   on a near-black ground is a wall of headlights. */
		filter: brightness(var(--deck-paper, 1)) var(--deck-shadow);
		transition:
			transform 420ms var(--deck-ease),
			filter 480ms var(--deck-ease);
		/* No `will-change`: promoting each page to its own layer makes the GPU
		   re-run two blurred drop-shadows per page per frame, and a library
		   scrolls past a lot of pages. */
	}

	:global(.deck:hover) .deck-fan,
	:global(.deck:focus-visible) .deck-fan {
		--fan: 9.5deg;
	}

	:global(.deck:hover) .deck-page,
	:global(.deck:focus-visible) .deck-page {
		--deck-shadow: var(--deck-shadow-lift);
	}

	@media (prefers-reduced-motion: reduce) {
		.deck-page {
			transition: none;
		}
		:global(.deck:hover) .deck-fan,
		:global(.deck:focus-visible) .deck-fan {
			--fan: 5deg;
		}
	}
</style>
