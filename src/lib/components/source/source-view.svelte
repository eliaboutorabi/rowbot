<script lang="ts">
	/**
	 * The document as Mistral saw it.
	 *
	 * Pages stack in one continuous scroll with a thumbnail rail beside them,
	 * so a seven-page report reads as seven pages rather than a widget with a
	 * page counter. Each page renders from the original upload — pdf.js to a
	 * canvas, or the file itself for an image — and the model's segmentation is
	 * laid over the top: every block boxed, typed, and carrying its own
	 * confidence. Table blocks link to the sheet they became.
	 *
	 * Pages and thumbnails render only as they approach the viewport, so a
	 * hundred-page PDF costs what you actually look at.
	 */
	import { onMount, tick } from 'svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Alert01Icon,
		Download04Icon,
		Loading03Icon,
		ViewIcon,
		ViewOffSlashIcon
	} from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import { openDocument, renderPage as drawPage } from '$lib/pdf';
	import { cn } from '$lib/utils';

	let {
		documentId,
		mimeType,
		linkedPaths = [],
		focus = null,
		onopentable
	}: {
		documentId: string;
		mimeType: string;
		/** Table paths that actually became sheets; only these are offered as links. */
		linkedPaths?: string[];
		/**
		 * A region to reveal. The nonce is what makes the same request twice
		 * scroll again — without it this effect sees no change on a repeat click.
		 */
		focus?: { tablePath: string; nonce: number } | null;
		onopentable?: (tablePath: string) => void;
	} = $props();

	interface Box {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	interface TableCorner {
		rows: string[][];
		totalRows: number;
		totalColumns: number;
		clipped: boolean;
	}

	interface Block {
		type: string;
		tablePath: string | null;
		preview: string;
		confidence: number | null;
		table: TableCorner | null;
		box: Box;
	}

	interface PageInfo {
		index: number;
		width: number | null;
		height: number | null;
		averageConfidence: number | null;
		blocks: Block[];
	}

	const isImage = $derived(mimeType.startsWith('image/'));
	const linked = $derived(new Set(linkedPaths));

	let pages = $state<PageInfo[]>([]);
	let loadError = $state<string | null>(null);
	let loading = $state(true);
	let overlay = $state(true);
	let current = $state(0);

	/** Which block the pointer is on, and where to float its card. */
	let hovered = $state<{ block: Block; x: number; y: number; above: boolean } | null>(null);

	let scroller = $state<HTMLDivElement>();
	const pageEls: HTMLElement[] = [];
	const thumbEls: HTMLElement[] = [];
	const pageCanvases: HTMLCanvasElement[] = [];
	const thumbCanvases: HTMLCanvasElement[] = [];
	// Plain Sets, not SvelteSets: these are render bookkeeping that no template
	// reads, and making them reactive would re-run the page list on every draw.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const rendered = new Set<number>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const thumbed = new Set<number>();

	/* ── Segmentation ────────────────────────────────────────────────── */

	onMount(async () => {
		try {
			const response = await fetch(`/api/pages/${documentId}`);
			if (!response.ok) throw new Error(`Could not load the page data (${response.status}).`);
			pages = (await response.json()).pages ?? [];
		} catch (cause) {
			loadError = cause instanceof Error ? cause.message : 'Could not load the page data.';
		} finally {
			loading = false;
		}
	});

	/* ── Rendering ───────────────────────────────────────────────────── */

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let pdf: any = null;
	let pdfLoading: Promise<void> | null = null;

	function ensurePdf(): Promise<void> {
		// pdf.js ships a worker and has no business in the server bundle, so it
		// is opened lazily and only once.
		pdfLoading ??= openDocument(`/api/source/${documentId}`).then((doc) => {
			pdf = doc;
		});
		return pdfLoading;
	}

	async function draw(canvas: HTMLCanvasElement, index: number, cssWidth: number) {
		await ensurePdf();
		const pdfPage = await pdf.getPage(index + 1);
		const unscaled = pdfPage.getViewport({ scale: 1 });
		const scale = cssWidth / unscaled.width;
		const ratio = Math.min(window.devicePixelRatio || 1, 2);
		const viewport = pdfPage.getViewport({ scale: scale * ratio });

		canvas.width = viewport.width;
		canvas.height = viewport.height;
		// No inline height: both canvases reserve the page's aspect ratio in CSS
		// before anything is drawn, so the box is already the right shape and an
		// inline pixel height computed from an assumed width can only fight it.

		const context = canvas.getContext('2d');
		if (context) await drawPage(pdfPage, canvas, context, viewport);
	}

	async function renderPage(index: number) {
		const canvas = pageCanvases[index];
		if (!canvas || rendered.has(index)) return;
		rendered.add(index);
		try {
			await draw(canvas, index, canvas.parentElement?.clientWidth || 700);
		} catch (cause) {
			rendered.delete(index);
			loadError = cause instanceof Error ? cause.message : 'Could not render that page.';
		}
	}

	async function renderThumb(index: number) {
		const canvas = thumbCanvases[index];
		if (!canvas || thumbed.has(index)) return;
		thumbed.add(index);
		try {
			await draw(canvas, index, 96);
		} catch {
			thumbed.delete(index);
		}
	}

	/** Render on approach, and track which page is centred so the rail follows. */
	$effect(() => {
		if (loading || !pages.length || isImage) return;
		void pages.length;

		const near = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const index = Number((entry.target as HTMLElement).dataset.page);
					renderPage(index);
					renderThumb(index);
				}
			},
			{ root: scroller, rootMargin: '600px 0px' }
		);

		tick().then(() => {
			for (const el of pageEls) {
				if (!el) continue;
				near.observe(el);
			}
			// The first few thumbnails are on screen before any scrolling happens.
			for (let i = 0; i < Math.min(pages.length, 6); i++) renderThumb(i);
			trackCurrent();
		});

		return () => near.disconnect();
	});

	/**
	 * Which page you are looking at, from the scroll position rather than from
	 * an observer.
	 *
	 * This started as a second IntersectionObserver watching a thin band across
	 * the middle of the viewport, which has an edge case with real consequences:
	 * on a wide window the pages shrink, and a page shorter than the band never
	 * intersects it, so the indicator and the thumbnail rail freeze on page one
	 * with no way to tell they have. Measuring which page owns the midpoint has
	 * no such gap — every scroll position has exactly one answer — and it costs
	 * one loop over a handful of elements.
	 */
	function trackCurrent() {
		if (!scroller) return;
		const box = scroller.getBoundingClientRect();
		const middle = box.top + box.height / 2;
		let best = 0;
		let closest = Infinity;
		for (let i = 0; i < pageEls.length; i++) {
			const el = pageEls[i];
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			// Inside this page: it owns the midpoint outright.
			if (rect.top <= middle && rect.bottom >= middle) {
				best = i;
				break;
			}
			// Otherwise the nearest edge wins, which covers the gutters between
			// pages and the run-off above the first and below the last.
			const gap = rect.top > middle ? rect.top - middle : middle - rect.bottom;
			if (gap < closest) {
				closest = gap;
				best = i;
			}
		}
		current = best;
	}

	/**
	 * The one way to move to a page — from the thumbnail rail, and from a cell
	 * in the sheet asking to be shown where it came from.
	 *
	 * Smooth is the nice default and the wrong one for anyone who has asked the
	 * system for less motion: seven pages of animated travel is exactly the
	 * movement that setting exists to stop. The indicator is nudged directly
	 * because an instant jump can land before a scroll event is dispatched.
	 */
	function goTo(index: number) {
		const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		pageEls[index]?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
		if (calm) trackCurrent();
	}

	/* ── Overlay ─────────────────────────────────────────────────────── */

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

	const TONES: Record<string, string> = {
		table: 'border-primary/70 bg-primary/10 hover:bg-primary/20',
		title: 'border-chart-2/70 bg-chart-2/10 hover:bg-chart-2/18',
		caption: 'border-chart-1/70 bg-chart-1/10 hover:bg-chart-1/18',
		image: 'border-chart-1/70 bg-chart-1/10 hover:bg-chart-1/18',
		header: 'border-muted-foreground/40 bg-muted-foreground/8',
		footer: 'border-muted-foreground/40 bg-muted-foreground/8'
	};
	const DEFAULT_TONE = 'border-foreground/25 bg-foreground/[0.05] hover:bg-foreground/10';
	const tone = (type: string) => TONES[type] ?? DEFAULT_TONE;

	const legend = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const page of pages) {
			for (const block of page.blocks) counts[block.type] = (counts[block.type] ?? 0) + 1;
		}
		return Object.entries(counts).sort((a, b) => b[1] - a[1]);
	});

	/**
	 * The card follows the pointer, not the block.
	 *
	 * A readout pinned to the bottom of the pane is invisible while you read the
	 * top of a page — but anchoring to the block is no better, because a table
	 * block is frequently the whole page and its edges are off-screen. The
	 * pointer is the one point guaranteed to be in view. Fixed positioning so
	 * the scrolling container cannot clip it.
	 */
	const CARD_WIDTH = 336;

	function place(event: MouseEvent | FocusEvent, block: Block) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const hasPointer = 'clientX' in event && event.clientX > 0;
		const x = hasPointer ? event.clientX : rect.left + rect.width / 2;
		const y = hasPointer ? event.clientY : rect.top;

		// Flip below the pointer when there is not enough room above it.
		const above = y > 260;
		const half = CARD_WIDTH / 2 + 8;
		hovered = {
			block,
			x: Math.min(Math.max(x, half), window.innerWidth - half),
			y: above ? y - 14 : y + 18,
			above
		};
	}

	/**
	 * Coming from a cell: scroll its page into view and pulse the block it was
	 * read from. Region-level rather than cell-level — Mistral gives a bounding
	 * box per block, not per cell, and dividing the box by the grid would be
	 * inventing coordinates for a product whose whole argument is that it
	 * doesn't invent things.
	 */
	let flashing = $state<string | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const request = focus;
		if (!request || loading || !pages.length) return;

		const page = pages.find((info) =>
			info.blocks.some((block) => block.tablePath === request.tablePath)
		);
		if (!page) return;

		flashing = request.tablePath;
		tick().then(() => goTo(page.index));

		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flashing = null), 2600);
		return () => clearTimeout(flashTimer);
	});

	/**
	 * Keep the rail showing the page you are on.
	 *
	 * Without this the rail is only useful for the first handful of pages: read
	 * your way to page fifteen and it is still showing one to six, with the
	 * highlight somewhere off the top. `nearest` so it scrolls the minimum, and
	 * never the page column — that is the thing the reader is looking at.
	 */
	$effect(() => {
		const target = thumbEls[current];
		if (!target) return;
		// `tick`, not `requestAnimationFrame`: this only needs Svelte to have
		// applied the class change, and a frame callback never arrives at all
		// while the tab is in the background.
		tick().then(() => target.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
	});

	const canLink = (block: Block) =>
		Boolean(block.tablePath && onopentable && linked.has(block.tablePath));
</script>

<div class="flex h-full min-h-0 flex-col">
	<!-- ── Toolbar ─────────────────────────────────────────────────── -->
	<div class="flex h-11 shrink-0 items-center gap-3 border-b px-3">
		<span class="shrink-0 text-xs text-muted-foreground tabular-nums">
			{#if pages.length}Page {current + 1} of {pages.length}{/if}
		</span>

		{#if overlay && legend.length}
			<div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 overflow-hidden">
				{#each legend as [type, count] (type)}
					<span class="flex items-center gap-1 text-[11px] whitespace-nowrap text-muted-foreground">
						<span class={cn('size-2.5 rounded-[3px] border', tone(type))}></span>
						{type.replace(/_/g, ' ')}
						<span class="text-muted-foreground tabular-nums">{count}</span>
					</span>
				{/each}
			</div>
		{:else}
			<div class="flex-1"></div>
		{/if}

		<div class="flex shrink-0 items-center gap-1">
			<Button variant="ghost" size="sm" onclick={() => (overlay = !overlay)}>
				<HugeiconsIcon icon={overlay ? ViewIcon : ViewOffSlashIcon} size={15} />
				{overlay ? 'Segmentation' : 'Page only'}
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				href={`/api/pages/${documentId}?raw`}
				download
				title="Download the OCR JSON"
			>
				<HugeiconsIcon icon={Download04Icon} size={15} />
				<span class="sr-only">Download the OCR JSON</span>
			</Button>
		</div>
	</div>

	<div class="flex min-h-0 flex-1">
		<!-- ── Thumbnail rail ──────────────────────────────────────── -->
		{#if pages.length > 1 && !isImage}
			<nav
				class="scroll-slim scroll-quiet w-[7.5rem] shrink-0 overflow-y-auto border-r bg-muted/20 p-2"
				aria-label="Pages"
			>
				<ul class="space-y-2">
					{#each pages as info (info.index)}
						<li>
							<button
								bind:this={thumbEls[info.index]}
								type="button"
								class={cn(
									'block w-full rounded-md p-1 text-left transition-colors',
									current === info.index ? 'bg-primary/10' : 'hover:bg-accent/60'
								)}
								aria-current={current === info.index ? 'page' : undefined}
								onclick={() => goTo(info.index)}
							>
								<!--
									The page's real aspect, reserved before anything is drawn.
									Thumbnails render lazily and used to resize as they arrived,
									which shuffled every entry below them down the rail — and
									moved the active one back out of view just after it had been
									scrolled into it.
								-->
								<span
									class={cn(
										'block overflow-hidden rounded-sm bg-white',
										current === info.index ? 'ring-2 ring-primary' : 'ring-1 ring-black/10'
									)}
								>
									<canvas
										bind:this={thumbCanvases[info.index]}
										width="96"
										height="124"
										class="block w-full"
										style:aspect-ratio={info.width && info.height
											? `${info.width} / ${info.height}`
											: '96 / 124'}
									></canvas>
								</span>
								<span
									class={cn(
										'mt-1 block text-center text-[11px] tabular-nums',
										current === info.index ? 'font-medium text-foreground' : 'text-muted-foreground'
									)}
								>
									{info.index + 1}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</nav>
		{/if}

		<!-- ── Pages ───────────────────────────────────────────────── -->
		<div
			bind:this={scroller}
			class="scroll-slim scroll-quiet relative min-h-0 flex-1 overflow-auto bg-muted/30 p-4"
			onscroll={trackCurrent}
		>
			{#if loading}
				<div class="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
					<HugeiconsIcon icon={Loading03Icon} size={16} class="animate-spin" />
					Loading the page…
				</div>
			{:else if loadError}
				<div
					class="mx-auto flex max-w-md items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
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
				<div class="mx-auto max-w-3xl space-y-5">
					{#each pages as info (info.index)}
						<section
							bind:this={pageEls[info.index]}
							data-page={info.index}
							aria-label={`Page ${info.index + 1}`}
						>
							<div
								class="relative overflow-hidden rounded-lg bg-white shadow-md ring-1 ring-black/10"
							>
								{#if isImage}
									<img
										src={`/api/source/${documentId}`}
										alt={`Page ${info.index + 1}`}
										class="block w-full"
									/>
								{:else}
									<canvas
										bind:this={pageCanvases[info.index]}
										class="block w-full"
										style:aspect-ratio={info.width && info.height
											? `${info.width} / ${info.height}`
											: '17 / 22'}
									></canvas>
								{/if}

								{#if overlay}
									<div class="absolute inset-0">
										{#each info.blocks as block, i (i)}
											{@const pos = percent(block.box, info)}
											<button
												type="button"
												class={cn(
													'absolute rounded-[3px] border transition-colors',
													tone(block.type),
													canLink(block) ? 'cursor-pointer' : 'cursor-default',
													flashing !== null &&
														block.tablePath === flashing &&
														'animate-[pulse_0.9s_ease-in-out_3] border-2 border-primary bg-primary/25 ring-4 ring-primary/30'
												)}
												style:left={pos.left}
												style:top={pos.top}
												style:width={pos.width}
												style:height={pos.height}
												onmouseenter={(e) => place(e, block)}
												onmousemove={(e) => place(e, block)}
												onmouseleave={() => (hovered = null)}
												onfocus={(e) => place(e, block)}
												onblur={() => (hovered = null)}
												onclick={() =>
													canLink(block) && block.tablePath && onopentable?.(block.tablePath)}
												aria-label={`${block.type} block on page ${info.index + 1}${
													canLink(block) ? ', open its sheet' : ''
												}`}
											></button>
										{/each}
									</div>
								{/if}
							</div>

							<p class="mt-1.5 text-center text-[11px] text-muted-foreground">
								Page {info.index + 1}
								{#if info.averageConfidence !== null}
									· {(info.averageConfidence * 100).toFixed(1)}% confident
								{/if}
							</p>
						</section>
					{/each}
				</div>
			{/if}

			<!-- ── Hover card, anchored to the block ───────────────── -->
			{#if hovered}
				<div
					class={cn(
						'pointer-events-none fixed z-50 w-[21rem] -translate-x-1/2',
						hovered.above && '-translate-y-full'
					)}
					style:left="{hovered.x}px"
					style:top="{hovered.y}px"
				>
					<div class="rounded-lg border bg-popover p-2.5 shadow-xl">
						<div class="flex items-baseline gap-2">
							<span class="text-xs font-medium capitalize">
								{hovered.block.type.replace(/_/g, ' ')}
							</span>
							{#if hovered.block.confidence !== null}
								<span class="text-[11px] text-muted-foreground tabular-nums">
									{(hovered.block.confidence * 100).toFixed(1)}%
								</span>
							{/if}
							{#if canLink(hovered.block)}
								<span class="ml-auto text-[11px] text-accent-ink">Click to open its sheet</span>
							{:else if hovered.block.type === 'table'}
								<span class="ml-auto text-[11px] text-muted-foreground">Not a sheet</span>
							{/if}
						</div>

						{#if hovered.block.table}
							{@const corner = hovered.block.table}
							<div class="mt-2 overflow-hidden rounded border">
								<table class="w-full border-collapse text-[11px]">
									<tbody>
										{#each corner.rows as row, r (r)}
											<tr>
												{#each row as cell, c (c)}
													<td
														class={cn(
															'max-w-[7rem] truncate border-r border-b px-1.5 py-1 last:border-r-0',
															r === 0
																? 'bg-muted/60 font-medium text-foreground'
																: 'text-muted-foreground'
														)}
													>
														{cell}
													</td>
												{/each}
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
							<p class="mt-1.5 text-[11px] text-muted-foreground">
								{corner.totalRows} × {corner.totalColumns}{corner.clipped
									? ' · top-left corner'
									: ''}
							</p>
						{:else if hovered.block.preview}
							<p class="mt-1.5 line-clamp-4 text-xs leading-relaxed text-muted-foreground">
								{hovered.block.preview}
							</p>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
