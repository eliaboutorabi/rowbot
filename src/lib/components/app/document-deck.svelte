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
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Image01Icon } from '@hugeicons/core-free-icons';

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
	const canvases: HTMLCanvasElement[] = [];
	let drawn = false;

	async function render() {
		if (drawn || isImage) return;
		drawn = true;

		try {
			const pdfjs = await import('pdfjs-dist');
			const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
			pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
			const pdf = await pdfjs.getDocument({ url: `/api/source/${documentId}` }).promise;

			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			const width = CARD_W * ratio;
			const height = CARD_H * ratio;

			for (let i = 0; i < Math.min(cards, pdf.numPages); i++) {
				const canvas = canvases[i];
				if (!canvas) continue;

				const page = await pdf.getPage(i + 1);
				const unscaled = page.getViewport({ scale: 1 });
				const viewport = page.getViewport({ scale: width / unscaled.width });

				// Fit the width, then keep the top of the page. A cover crop from the
				// centre would slice the header off every thumbnail, and the header
				// is the part that identifies the page.
				const offscreen = document.createElement('canvas');
				offscreen.width = viewport.width;
				offscreen.height = viewport.height;
				const offContext = offscreen.getContext('2d');
				if (!offContext) continue;
				offContext.fillStyle = '#ffffff';
				offContext.fillRect(0, 0, offscreen.width, offscreen.height);
				await page.render({ canvas: offscreen, canvasContext: offContext, viewport }).promise;

				canvas.width = width;
				canvas.height = height;
				const context = canvas.getContext('2d');
				if (!context) continue;
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
			}
		} catch {
			// A thumbnail is decoration; a failed one must not break the library.
			drawn = false;
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
			{ rootMargin: '400px 0px' }
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
				class="deck-page"
				style:--i={index}
				width={CARD_W}
				height={CARD_H}
				aria-hidden={index > 0 ? 'true' : undefined}
				aria-label={index === 0 ? `First page of ${name}` : undefined}
			></canvas>
		{/each}
	{/if}

	{#if !pageCount && isImage}
		<span class="sr-only"><HugeiconsIcon icon={Image01Icon} size={12} /></span>
	{/if}
</div>

<style>
	.deck-fan {
		position: relative;
		/* Room for the widest swing: the outer pages dip below the pivot and
		   rise above the middle page, and this is exactly that envelope. */
		aspect-ratio: 1 / 0.83;
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
		border-radius: 6px;

		transform-origin: 50% 100%;
		transform: rotate(calc((var(--i) - (var(--n) - 1) / 2) * var(--fan, 5deg)));

		/* The shadow goes last in the chain. Anything after it gets filtered too,
		   which rings every page in a halo. */
		filter: brightness(calc(1 - var(--i) * 0.05)) var(--deck-shadow);
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
