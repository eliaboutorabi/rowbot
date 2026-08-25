<script lang="ts">
	/**
	 * The document as Mistral saw it.
	 *
	 * The page itself is rendered from the original upload — pdf.js to a canvas
	 * for PDFs, the file directly for images — and the model's segmentation is
	 * laid over the top: every block it found, boxed, typed and coloured, with
	 * its own confidence. Table blocks carry the id of the table that became a
	 * sheet, so clicking one crosses over to the workbook.
	 *
	 * None of this data is new. It has been written to `document_page` since
	 * the first OCR pass and never read back.
	 */
	import { onMount, untrack } from 'svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Alert01Icon,
		ArrowLeft01Icon,
		ArrowRight01Icon,
		Download04Icon,
		Loading03Icon,
		ViewIcon,
		ViewOffSlashIcon
	} from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';

	let {
		documentId,
		mimeType,
		linkedPaths = [],
		onopentable
	}: {
		documentId: string;
		mimeType: string;
		/**
		 * Table paths that actually became sheets. Only these blocks are offered
		 * as clickable — a table the agent chose to skip, or one imported before
		 * sheets recorded their source, would otherwise look like a dead link.
		 */
		linkedPaths?: string[];
		/** Called with the OCR table's workspace path when a table block is clicked. */
		onopentable?: (tablePath: string) => void;
	} = $props();

	const linked = $derived(new Set(linkedPaths));

	interface Box {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	interface Block {
		type: string;
		tablePath: string | null;
		preview: string;
		confidence: number | null;
		box: Box;
	}

	interface PageInfo {
		index: number;
		width: number | null;
		height: number | null;
		averageConfidence: number | null;
		minimumConfidence: number | null;
		tableIds: string[];
		blocks: Block[];
	}

	const isImage = $derived(mimeType.startsWith('image/'));

	let pages = $state<PageInfo[]>([]);
	let loadError = $state<string | null>(null);
	let loading = $state(true);
	let current = $state(0);
	let overlay = $state(true);
	let hovered = $state<Block | null>(null);

	let frame = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let rendering = $state(false);

	const page = $derived(pages[current] ?? null);

	/**
	 * Blocks are positioned as percentages of the page box Mistral reported,
	 * so the overlay stays correct at any render scale or zoom.
	 */
	function percent(box: Box, info: PageInfo) {
		const w = info.width || 1;
		const h = info.height || 1;
		return {
			left: `${(box.x / w) * 100}%`,
			top: `${(box.y / h) * 100}%`,
			width: `${(box.width / w) * 100}%`,
			height: `${(box.height / h) * 100}%`
		};
	}

	/** One hue per family, so a page reads at a glance. */
	const TONES: Record<string, string> = {
		table: 'border-primary/70 bg-primary/12 hover:bg-primary/20',
		title: 'border-chart-2/70 bg-chart-2/12 hover:bg-chart-2/20',
		caption: 'border-chart-1/60 bg-chart-1/10 hover:bg-chart-1/18',
		image: 'border-chart-1/60 bg-chart-1/10 hover:bg-chart-1/18',
		header: 'border-muted-foreground/40 bg-muted-foreground/8',
		footer: 'border-muted-foreground/40 bg-muted-foreground/8'
	};
	const DEFAULT_TONE = 'border-foreground/25 bg-foreground/[0.06] hover:bg-foreground/12';
	const tone = (type: string) => TONES[type] ?? DEFAULT_TONE;

	/** Block types present on this page, for the legend. */
	const legend = $derived.by(() => {
		// A plain object, not a Map: this is a throwaway tally inside one
		// derivation, and nothing reads it as reactive state.
		const counts: Record<string, number> = {};
		for (const block of page?.blocks ?? []) {
			counts[block.type] = (counts[block.type] ?? 0) + 1;
		}
		return Object.entries(counts).sort((a, b) => b[1] - a[1]);
	});

	/* ── Loading the segmentation ────────────────────────────────────── */

	onMount(async () => {
		try {
			const response = await fetch(`/api/pages/${documentId}`);
			if (!response.ok) throw new Error(`Could not load the page data (${response.status}).`);
			const body = await response.json();
			pages = body.pages ?? [];
		} catch (cause) {
			loadError = cause instanceof Error ? cause.message : 'Could not load the page data.';
		} finally {
			loading = false;
		}
	});

	/* ── Rendering the page itself ───────────────────────────────────── */

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let pdf = $state<any>(null);

	async function loadPdf() {
		// Imported lazily and only in the browser: pdf.js pulls in a worker and
		// has no business in the server bundle.
		const pdfjs = await import('pdfjs-dist');
		const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
		pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
		pdf = await pdfjs.getDocument({ url: `/api/source/${documentId}` }).promise;
	}

	async function renderPage(index: number) {
		if (!pdf || !canvas || !frame) return;
		rendering = true;
		try {
			const pdfPage = await pdf.getPage(index + 1);
			const unscaled = pdfPage.getViewport({ scale: 1 });
			// Fit the width of the frame, then draw at device resolution so the
			// page stays crisp on a retina display.
			const width = frame.clientWidth;
			const scale = width / unscaled.width;
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			const viewport = pdfPage.getViewport({ scale: scale * ratio });

			canvas.width = viewport.width;
			canvas.height = viewport.height;
			canvas.style.width = `${width}px`;
			canvas.style.height = `${unscaled.height * scale}px`;

			const context = canvas.getContext('2d');
			if (context) await pdfPage.render({ canvasContext: context, viewport }).promise;
		} catch (cause) {
			loadError = cause instanceof Error ? cause.message : 'Could not render that page.';
		} finally {
			rendering = false;
		}
	}

	$effect(() => {
		if (isImage || loading || !pages.length) return;
		const index = current;
		untrack(async () => {
			if (!pdf) await loadPdf();
			await renderPage(index);
		});
	});

	const canPrev = $derived(current > 0);
	const canNext = $derived(current < pages.length - 1);
</script>

<div class="flex h-full min-h-0 flex-col">
	<!-- ── Toolbar ─────────────────────────────────────────────────── -->
	<div class="flex h-11 shrink-0 items-center gap-2 border-b px-3">
		{#if pages.length > 1}
			<div class="flex items-center gap-0.5">
				<Button
					variant="ghost"
					size="icon-sm"
					disabled={!canPrev}
					onclick={() => (current -= 1)}
					aria-label="Previous page"
				>
					<HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
				</Button>
				<span class="min-w-[4.5rem] text-center text-xs text-muted-foreground tabular-nums">
					Page {current + 1} of {pages.length}
				</span>
				<Button
					variant="ghost"
					size="icon-sm"
					disabled={!canNext}
					onclick={() => (current += 1)}
					aria-label="Next page"
				>
					<HugeiconsIcon icon={ArrowRight01Icon} size={16} />
				</Button>
			</div>
		{:else if pages.length === 1}
			<span class="text-xs text-muted-foreground">1 page</span>
		{/if}

		{#if page?.averageConfidence !== null && page?.averageConfidence !== undefined}
			<span class="text-xs text-muted-foreground/70">
				· {(page.averageConfidence * 100).toFixed(1)}% average confidence
			</span>
		{/if}

		<div class="ml-auto flex items-center gap-1">
			<Button variant="ghost" size="sm" onclick={() => (overlay = !overlay)}>
				<HugeiconsIcon icon={overlay ? ViewIcon : ViewOffSlashIcon} size={15} />
				{overlay ? 'Segmentation' : 'Page only'}
			</Button>
			<Button variant="ghost" size="icon-sm" href={`/api/pages/${documentId}?raw`} download>
				<HugeiconsIcon icon={Download04Icon} size={15} />
				<span class="sr-only">Download the OCR JSON</span>
			</Button>
		</div>
	</div>

	<!-- ── Legend ──────────────────────────────────────────────────── -->
	{#if overlay && legend.length}
		<div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2">
			{#each legend as [type, count] (type)}
				<span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
					<span class={cn('size-2.5 rounded-[3px] border', tone(type))}></span>
					{type.replace(/_/g, ' ')}
					<span class="text-muted-foreground/50 tabular-nums">{count}</span>
				</span>
			{/each}
		</div>
	{/if}

	<!-- ── Page ────────────────────────────────────────────────────── -->
	<div class="min-h-0 flex-1 overflow-auto bg-muted/30 p-4">
		{#if loading}
			<div class="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
				<HugeiconsIcon icon={Loading03Icon} size={16} class="animate-spin" />
				Loading the page…
			</div>
		{:else if loadError}
			<div
				class="mx-auto flex max-w-md items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-sm text-destructive"
			>
				<HugeiconsIcon icon={Alert01Icon} size={16} class="mt-0.5 shrink-0" />
				{loadError}
			</div>
		{:else if !pages.length}
			<div class="flex h-full flex-col items-center justify-center gap-1.5 text-center">
				<p class="text-sm font-medium">Nothing has been read yet</p>
				<p class="max-w-xs text-sm text-muted-foreground">
					Ask Rowbot to extract the tables and the page segmentation will appear here.
				</p>
			</div>
		{:else}
			<div class="mx-auto max-w-3xl">
				<div
					bind:this={frame}
					class="relative overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black/10"
				>
					{#if isImage}
						<img
							src={`/api/source/${documentId}`}
							alt="Page 1 of the uploaded document"
							class="block w-full"
						/>
					{:else}
						<canvas bind:this={canvas} class="block w-full"></canvas>
						{#if rendering}
							<div class="absolute inset-0 grid place-items-center bg-white/60">
								<HugeiconsIcon icon={Loading03Icon} size={18} class="animate-spin text-primary" />
							</div>
						{/if}
					{/if}

					{#if overlay && page}
						<div class="pointer-events-none absolute inset-0">
							{#each page.blocks as block, i (i)}
								{@const pos = percent(block.box, page)}
								{@const clickable = Boolean(
									block.tablePath && onopentable && linked.has(block.tablePath)
								)}
								<button
									type="button"
									class={cn(
										'pointer-events-auto absolute rounded-[3px] border transition-colors',
										tone(block.type),
										clickable ? 'cursor-pointer' : 'cursor-default'
									)}
									style:left={pos.left}
									style:top={pos.top}
									style:width={pos.width}
									style:height={pos.height}
									onmouseenter={() => (hovered = block)}
									onmouseleave={() => (hovered = null)}
									onfocus={() => (hovered = block)}
									onblur={() => (hovered = null)}
									onclick={() => clickable && block.tablePath && onopentable?.(block.tablePath)}
									aria-label={`${block.type} block${clickable ? ', open its sheet' : ''}`}
								></button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Hover readout, below the page so it never covers what it describes. -->
				<div class="mt-3 min-h-[2.75rem] rounded-lg border bg-card px-3 py-2">
					{#if hovered}
						<div class="flex items-baseline gap-2">
							<span class="text-xs font-medium capitalize">{hovered.type.replace(/_/g, ' ')}</span>
							{#if hovered.confidence !== null}
								<span class="text-[11px] text-muted-foreground tabular-nums">
									{(hovered.confidence * 100).toFixed(1)}% confident
								</span>
							{/if}
							{#if hovered.tablePath && onopentable && linked.has(hovered.tablePath)}
								<span class="ml-auto text-[11px] text-primary">Click to open its sheet</span>
							{:else if hovered.type === 'table'}
								<span class="ml-auto text-[11px] text-muted-foreground/60">
									Not imported as a sheet
								</span>
							{/if}
						</div>
						{#if hovered.preview}
							<p class="mt-1 truncate text-xs text-muted-foreground">{hovered.preview}</p>
						{/if}
					{:else}
						<p class="text-xs text-muted-foreground">
							Hover a block to see what the model read there.
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
