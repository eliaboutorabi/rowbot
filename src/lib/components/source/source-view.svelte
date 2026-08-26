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
	 *
	 * The paper comes first. This used to be driven entirely off the OCR rows,
	 * so a document that had been uploaded but not yet read showed "nothing has
	 * been read yet" — which was true of the segmentation and quite untrue of
	 * the file, which was sitting in storage and perfectly renderable. Nobody
	 * should have to run an agent to find out what they just uploaded. The page
	 * list therefore comes from the file's own page count, known at upload, and
	 * the segmentation is an overlay that arrives later and lands on pages that
	 * are already on screen.
	 */
	import { onMount, tick, untrack } from 'svelte';
	import Icon from '$lib/components/ui/icon.svelte';
	import {
		Alert01Icon,
		Download04Icon,
		Loading03Icon,
		ViewIcon,
		ViewOffSlashIcon
	} from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import { openDocument, pageTextRuns, renderPage as drawPage } from '$lib/pdf';
	import { locateCell, type Box as CellBox, type Precision, type TextRun } from '$lib/cell-locate';
	import type { SourceFocus } from './focus';
	import { cn } from '$lib/utils';
	import { listNumbers, missingPages } from '$lib/page-gaps';

	let {
		documentId,
		mimeType,
		linkedPaths = [],
		readVersion = 0,
		focus = null,
		onopentable
	}: {
		documentId: string;
		mimeType: string;
		/**
		 * Ticks when the document has just been read.
		 *
		 * The segmentation is fetched once when this pane opens, so without this
		 * the reviewer watching the page during the very run that reads it sees
		 * nothing until they reload. This used to wait for the run to *end*,
		 * which is worse than it sounds: reading happens in the first few seconds
		 * and the rest of a run can be minutes of building the workbook, all of
		 * it spent looking at an un-annotated page with a notice saying nobody
		 * has read it.
		 */
		readVersion?: number;
		/** Table paths that actually became sheets; only these are offered as links. */
		linkedPaths?: string[];
		/**
		 * A region to reveal. The nonce is what makes the same request twice
		 * scroll again — without it this effect sees no change on a repeat click.
		 */
		focus?: SourceFocus | null;
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
	/** Pages in the file itself, which is not always how many we hold a read for. */
	let pageCount = $state(0);
	/**
	 * Page shapes taken from the PDF, for the pages OCR has not described.
	 *
	 * A canvas with no aspect ratio is a flat line until it is drawn, and a
	 * column of flat lines that each jump to full height as they render is the
	 * layout shifting under someone who is trying to read it. Page one is
	 * measured as soon as the file opens and stands in for the rest — documents
	 * are overwhelmingly one shape throughout — and every page corrects itself
	 * to its own dimensions the moment it is actually drawn.
	 */
	let sizes = $state<Record<number, { width: number; height: number }>>({});
	let loadError = $state<string | null>(null);
	let loading = $state(true);
	let overlay = $state(true);
	let current = $state(0);

	/** A blank page, for one the reader has not described. */
	const bare = (index: number): PageInfo => ({
		index,
		width: null,
		height: null,
		averageConfidence: null,
		blocks: []
	});

	/**
	 * Every page of the file, carrying its read where there is one.
	 *
	 * Falls back to the rows themselves if the count is missing, so a document
	 * from before the count was recorded still shows what it has.
	 */
	const views = $derived.by(() => {
		const read = new Map(pages.map((page) => [page.index, page]));
		const total = pageCount || pages.length;
		return Array.from({ length: total }, (_, index) => read.get(index) ?? bare(index));
	});

	/** The shape to reserve for a page: its own, the file's, or a portrait guess. */
	function aspect(info: PageInfo): string {
		if (info.width && info.height) return `${info.width} / ${info.height}`;
		const measured = sizes[info.index] ?? sizes[0];
		return measured ? `${measured.width} / ${measured.height}` : '17 / 22';
	}

	/** Which block the pointer is on, and where to float its card. */
	let hovered = $state<{ block: Block; x: number; y: number; above: boolean } | null>(null);

	let scroller = $state<HTMLDivElement>();
	// Reactive: effects read through these to observe pages and to keep the
	// rail's active thumbnail in view, and `bind:this` into a plain array is a
	// write Svelte cannot see — so those effects would run once, against
	// nothing, and never again.
	const pageEls = $state<HTMLElement[]>([]);
	const thumbEls = $state<HTMLElement[]>([]);
	const pageCanvases = $state<HTMLCanvasElement[]>([]);
	const thumbCanvases = $state<HTMLCanvasElement[]>([]);
	// Plain Sets, not SvelteSets: these are render bookkeeping that no template
	// reads, and making them reactive would re-run the page list on every draw.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const rendered = new Set<number>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const thumbed = new Set<number>();

	/* ── Segmentation ────────────────────────────────────────────────── */

	async function loadSegmentation() {
		try {
			const response = await fetch(`/api/pages/${documentId}`);
			if (!response.ok) throw new Error(`Could not load the page data (${response.status}).`);
			const body = await response.json();
			pages = body.pages ?? [];
			pageCount = body.pageCount ?? pages.length;
		} catch (cause) {
			loadError = cause instanceof Error ? cause.message : 'Could not load the page data.';
		} finally {
			loading = false;
		}
	}

	onMount(loadSegmentation);

	/**
	 * Pick up a read the moment it lands, while this pane is open.
	 *
	 * Keyed on the tick rather than on a run finishing, so the boxes arrive with
	 * the read. Nothing fetches on the first pass — `onMount` has that — and a
	 * turn that renames a column ticks nothing, so the blocks of a forty-page
	 * document are not re-downloaded for free.
	 */
	// Plain, not `$state`: the effect writes it, and a reactive value it also
	// reads would make it re-run itself. `untrack` because the initial value is
	// exactly what is wanted — whatever the count is when this pane opens has,
	// by definition, already been fetched by `onMount`.
	let seenVersion = untrack(() => readVersion);
	$effect(() => {
		const version = readVersion;
		if (version === seenVersion) return;
		seenVersion = version;
		void loadSegmentation();
	});

	/* ── Rendering ───────────────────────────────────────────────────── */

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let pdf: any = null;
	let pdfLoading: Promise<void> | null = null;

	function ensurePdf(): Promise<void> {
		// pdf.js ships a worker and has no business in the server bundle, so it
		// is opened lazily and only once.
		pdfLoading ??= openDocument(`/api/source/${documentId}`).then(async (doc) => {
			pdf = doc;
			// One page, so the column is the right shape before anything is drawn.
			const first = await doc.getPage(1);
			const { width, height } = first.getViewport({ scale: 1 });
			sizes = { ...sizes, 0: { width, height } };
		});
		return pdfLoading;
	}

	async function draw(canvas: HTMLCanvasElement, index: number, cssWidth: number) {
		await ensurePdf();
		const pdfPage = await pdf.getPage(index + 1);
		const unscaled = pdfPage.getViewport({ scale: 1 });
		if (!sizes[index]) {
			sizes = { ...sizes, [index]: { width: unscaled.width, height: unscaled.height } };
		}
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
		if (loading || !views.length || isImage) return;
		void views.length;

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
			// The first few thumbnails are on screen before any scrolling happens,
			// and so is the first page. Waiting to be told that page one is visible
			// is a round trip to learn something already known, and it shows: the
			// pane opens on a white rectangle and fills in a moment later.
			for (let i = 0; i < Math.min(views.length, 6); i++) renderThumb(i);
			renderPage(0);
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

	/*
	 * Paper colours, not interface colours — see `--seg-ink` in layout.css.
	 * These boxes sit on a white scan whichever theme the app is wearing.
	 */
	const TONES: Record<string, string> = {
		table: 'border-[var(--seg-table)]/75 bg-[var(--seg-table)]/10 hover:bg-[var(--seg-table)]/20',
		title: 'border-[var(--seg-title)]/75 bg-[var(--seg-title)]/10 hover:bg-[var(--seg-title)]/18',
		caption:
			'border-[var(--seg-figure)]/75 bg-[var(--seg-figure)]/10 hover:bg-[var(--seg-figure)]/18',
		image:
			'border-[var(--seg-figure)]/75 bg-[var(--seg-figure)]/10 hover:bg-[var(--seg-figure)]/18',
		header: 'border-[var(--seg-ink-soft)]/45 bg-[var(--seg-ink-soft)]/8',
		footer: 'border-[var(--seg-ink-soft)]/45 bg-[var(--seg-ink-soft)]/8'
	};
	const DEFAULT_TONE =
		'border-[var(--seg-ink)]/40 bg-[var(--seg-ink)]/[0.06] hover:bg-[var(--seg-ink)]/12';
	const tone = (type: string) => TONES[type] ?? DEFAULT_TONE;

	const legend = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const page of pages) {
			for (const block of page.blocks) counts[block.type] = (counts[block.type] ?? 0) + 1;
		}
		return Object.entries(counts).sort((a, b) => b[1] - a[1]);
	});

	/** Pages of the file we hold no read for. See `page-gaps.ts`. */
	const missing = $derived(
		loading || !pages.length
			? // Nothing read at all is not a gap in a read — it is a document
				// nobody has asked about yet, and telling someone to "read it again"
				// before they have read it once is nonsense.
				[]
			: missingPages(
					pageCount,
					pages.map((page) => page.index)
				)
	);

	/** Read, but not yet by us. Distinguishes "not started" from "went wrong". */
	const unread = $derived(!loading && !loadError && views.length > 0 && pages.length === 0);

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
	 * Coming from a cell: scroll its page into view, pulse the block it was
	 * read from, and — when the file will say where — pick out the figure
	 * itself rather than the whole table.
	 *
	 * Mistral gives a bounding box per block and nothing inside it, so the
	 * geometry comes from the PDF's own text layer. Where there is no text
	 * layer the highlight drops to the row, and says so, because a box drawn
	 * confidently in the wrong place is worse than a box round the table in an
	 * application whose argument is that you can check its working.
	 */
	let flashing = $state<string | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	let pinned = $state<{ page: number; box: CellBox; precision: Precision } | null>(null);

	/** Text runs per page. Reading them costs a parse, and pages get revisited. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const runsByPage = new Map<number, TextRun[]>();

	async function textRuns(info: PageInfo): Promise<TextRun[]> {
		const held = runsByPage.get(info.index);
		if (held) return held;
		if (isImage || !info.width || !info.height) return [];

		try {
			await ensurePdf();
			const runs = await pageTextRuns(pdf, info.index + 1, {
				width: info.width,
				height: info.height
			});
			runsByPage.set(info.index, runs);
			return runs;
		} catch {
			// A page whose text layer will not parse is a page we fall back on,
			// not an error worth putting in front of anybody.
			runsByPage.set(info.index, []);
			return [];
		}
	}

	$effect(() => {
		const request = focus;
		if (!request || loading || !pages.length) return;

		const page = pages.find((info) =>
			info.blocks.some((block) => block.tablePath === request.tablePath)
		);
		if (!page) return;

		flashing = request.tablePath;
		pinned = null;
		tick().then(() => goTo(page.index));

		const block = page.blocks.find((candidate) => candidate.tablePath === request.tablePath);
		const cell = request.cell;
		if (block && cell) {
			void textRuns(page).then((runs) => {
				// A later click while this was loading owns the highlight now.
				if (focus !== request) return;
				const found = locateCell({
					table: block.box,
					runs,
					text: cell.text,
					raw: cell.raw,
					row: cell.row,
					rows: cell.rows
				});
				pinned = { page: page.index, box: found.box, precision: found.precision };
			});
		}

		// The pulse is an arrival, so it ends. The mark on the figure stays:
		// somebody who asked to be shown where a number came from is going to
		// look at it for longer than a few seconds, and having it vanish while
		// they read is the sort of thing that makes a feature feel unreliable.
		// It clears when they ask for something else, or when they dismiss it.
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
			{#if views.length}Page {current + 1} of {views.length}{/if}
		</span>

		{#if overlay && legend.length}
			<div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 overflow-hidden">
				{#each legend as [type, count] (type)}
					<span class="flex items-center gap-1 text-[11px] whitespace-nowrap text-muted-foreground">
						<!-- A white backing, because the swatch is a miniature of a box
						     drawn on paper and the tones are mixed for paper. -->
						<span class="size-2.5 shrink-0 rounded-[3px] bg-white">
							<span class={cn('block size-full rounded-[3px] border', tone(type))}></span>
						</span>
						{type.replace(/_/g, ' ')}
						<span class="text-muted-foreground tabular-nums">{count}</span>
					</span>
				{/each}
			</div>
		{:else}
			<div class="flex-1"></div>
		{/if}

		<div class="flex shrink-0 items-center gap-1">
			<!--
				The label names what is on, not what a click would turn on. Toggles
				that flip their own label to the opposite state are ambiguous in both
				positions — "Page only" could as easily mean you are looking at the
				page only as that clicking gets you there — and `aria-pressed` is
				what settles it for anyone not reading the icon.
			-->
			<Button
				variant="ghost"
				size="sm"
				class={overlay ? 'text-accent-ink hover:text-accent-ink' : 'text-muted-foreground'}
				aria-pressed={overlay}
				title={overlay ? 'Hide what the reader found' : 'Show what the reader found'}
				onclick={() => (overlay = !overlay)}
			>
				<Icon icon={overlay ? ViewIcon : ViewOffSlashIcon} size={15} />
				Segmentation
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				href={`/api/pages/${documentId}?raw`}
				download
				title="Download the OCR JSON"
			>
				<Icon icon={Download04Icon} size={15} />
				<span class="sr-only">Download the OCR JSON</span>
			</Button>
		</div>
	</div>

	<!-- ── Uploaded, not yet read ──────────────────────────────────── -->
	{#if unread}
		<p class="flex shrink-0 items-start gap-2 border-b bg-muted/40 px-3 py-2 text-xs" role="status">
			<Icon icon={ViewOffSlashIcon} size={14} class="mt-px shrink-0 text-muted-foreground" />
			<span class="text-muted-foreground">
				This is the file as you uploaded it. Ask Rowbot to read it and the segmentation — every
				block it found, typed and scored — will be laid over these pages.
			</span>
		</p>
	{/if}

	<!-- ── Pages we have no read for ───────────────────────────────── -->
	{#if missing.length}
		<p
			class="flex shrink-0 items-start gap-2 border-b bg-destructive/8 px-3 py-2 text-xs text-destructive"
			role="status"
		>
			<Icon icon={Alert01Icon} size={14} class="mt-px shrink-0" />
			<span>
				{missing.length === 1 ? 'Page' : 'Pages'}
				{listNumbers(missing)} of {pageCount}
				{missing.length === 1 ? 'has' : 'have'} no read stored. Ask Rowbot to read the document again
				to restore {missing.length === 1 ? 'it' : 'them'}.
			</span>
		</p>
	{/if}

	<div class="flex min-h-0 flex-1">
		<!-- ── Thumbnail rail ──────────────────────────────────────── -->
		{#if views.length > 1 && !isImage}
			<nav
				class="scroll-slim w-[7.5rem] shrink-0 overflow-y-auto border-r bg-muted/20 p-2"
				aria-label="Pages"
			>
				<ul class="space-y-2">
					{#each views as info (info.index)}
						<li>
							<button
								bind:this={thumbEls[info.index]}
								type="button"
								class={cn(
									'block w-full rounded-md p-1 text-left transition-colors',
									current === info.index ? 'bg-primary/10' : 'hover:bg-accent/60'
								)}
								aria-current={current === info.index ? 'page' : undefined}
								aria-label={`Page ${info.index + 1}`}
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
										style:aspect-ratio={aspect(info)}
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
			class="scroll-slim relative min-h-0 flex-1 overflow-auto bg-muted/30 p-4"
			onscroll={trackCurrent}
		>
			{#if loading}
				<div class="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
					<Icon icon={Loading03Icon} size={16} class="animate-spin" />
					Loading the page…
				</div>
			{:else if loadError}
				<div
					class="mx-auto flex max-w-md items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
				>
					<Icon icon={Alert01Icon} size={16} class="mt-0.5 shrink-0" />
					{loadError}
				</div>
			{:else if !views.length}
				<div class="flex h-full flex-col items-center justify-center gap-1.5 text-center">
					<p class="text-sm font-medium">There is nothing to show</p>
					<p class="max-w-xs text-sm text-muted-foreground">
						This document has no pages we can render.
					</p>
				</div>
			{:else}
				<div class="mx-auto max-w-3xl space-y-5">
					{#each views as info (info.index)}
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
										style:aspect-ratio={aspect(info)}
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
														// Quieter once the figure itself is marked: two things
														// pulsing at once and the reader looks at the bigger
														// one, which is the table they already knew about.
														(pinned
															? 'border-primary/50 !bg-transparent'
															: 'animate-[pulse_0.9s_ease-in-out_3] border-2 border-primary bg-primary/25 ring-4 ring-primary/30')
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

								<!-- ── The cell you came here to see ──────────────
								     Outside the `overlay` block: turning the segmentation
								     off should not take away the one thing that was
								     explicitly asked for. -->
								{#if pinned && pinned.page === info.index}
									{@const at = percent(pinned.box, info)}
									<button
										type="button"
										aria-label="Hide this mark"
										onclick={() => (pinned = null)}
										class={cn(
											'absolute cursor-pointer rounded-[2px]',
											'animate-[pulse_0.9s_ease-in-out_3]',
											// A found figure is drawn tight and solid; an inferred row
											// dashed, so it does not claim to know which column. Both
											// come from plain CSS rather than utilities: tailwind-merge
											// treats everything starting `ring-` as one group and drops
											// all but the last, which ate the dashes the first time.
											pinned.precision === 'cell' ? 'seg-mark-cell' : 'seg-mark-row'
										)}
										style:left={at.left}
										style:top={at.top}
										style:width={at.width}
										style:height={at.height}
									></button>
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
