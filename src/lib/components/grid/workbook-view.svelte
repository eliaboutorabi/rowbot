<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/icon.svelte';
	import {
		BorderBottom01Icon,
		Alert01Icon,
		ArrowLeftRightIcon,
		Clock01Icon,
		Download04Icon,
		FileSpreadsheetIcon,
		File01Icon,
		Note01Icon,
		ThermometerIcon
	} from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import SheetGrid from './sheet-grid.svelte';
	import CellInspector from './cell-inspector.svelte';
	import SourceView from '$lib/components/source/source-view.svelte';
	import { cn } from '$lib/utils';
	import type { WorkbookModel } from '$lib/types/workbook';
	import { formatRef, parseRef, type SheetRef } from '$lib/sheet-ref';
	import { originForRow } from '$lib/sheet-source';
	import type { SourceFocus } from '$lib/components/source/focus';
	import { isRightToLeft } from '$lib/sheet-direction';
	import {
		confidenceColor,
		confidenceGradient,
		confidenceOffset,
		confidenceWords
	} from '$lib/confidence';
	import { renderMarkdown } from '$lib/markdown';
	import { timeAgo } from '$lib/format';
	import { toast } from 'svelte-sonner';

	let {
		workbook,
		documentId,
		mimeType,
		busy = false,
		finished = false,
		reveal = null,
		onattach,
		onedited
	}: {
		workbook: WorkbookModel | null;
		documentId: string;
		mimeType: string;
		busy?: boolean;
		/** A run has been through this document and stopped. */
		finished?: boolean;
		/** A reference the agent wrote, to select and scroll to. */
		reveal?: { ref: SheetRef; nonce: number } | null;
		/** Send the current selection to the composer. */
		onattach?: (ref: SheetRef) => void;
		/** A reviewer's own correction, already persisted. */
		onedited?: (workbook: WorkbookModel) => void;
	} = $props();

	let range = $state<SheetRef | null>(null);
	let grid = $state<ReturnType<typeof SheetGrid>>();

	/**
	 * Persist a cell the reviewer typed.
	 *
	 * The server appends a workbook revision, exactly as an agent turn does, so
	 * an edit is part of the same history and the next run starts from it. The
	 * new model comes back rather than being patched locally, because the server
	 * is the one that decides how a typed string becomes a cell.
	 */
	async function saveCell(edit: { row: number; column: number; value: string; expect: string }) {
		if (!active) return;
		try {
			const response = await fetch(`/api/workbook/${documentId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sheetId: active.id, ...edit })
			});
			if (!response.ok) {
				const detail = await response.json().catch(() => null);
				toast.error('Could not save that edit', { description: detail?.message });
				return;
			}
			const { workbook: next } = await response.json();
			onedited?.(next as WorkbookModel);
		} catch {
			toast.error('Could not save that edit', { description: 'The change was not stored.' });
		}
	}

	/**
	 * Clicking away from the workbook clears the selection.
	 *
	 * A highlighted cell and an inspector describing it are a statement about
	 * what you are looking at, and they were surviving every click that moved
	 * you somewhere else — into the conversation, the nav bar, another pane —
	 * leaving the sheet insisting on a cell you had finished with.
	 *
	 * The boundary is the whole workbook column rather than the grid alone, so
	 * the toolbar, the sheet tabs and the inspector's own buttons all still act
	 * on the selection they are about. And it fires on `pointerdown`, before
	 * any click handler: a reference chip in the agent's prose clears the old
	 * selection on the way down and sets the new one on the way up.
	 */
	let pane = $state<HTMLElement>();

	$effect(() => {
		function onPointerDown(event: PointerEvent) {
			const target = event.target;
			if (!(target instanceof Node) || !pane || pane.contains(target)) return;
			grid?.clearSelection();
		}
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	});

	/** Select what a reference points at, wherever the reference was written. */
	function focusRef(ref: SheetRef) {
		const wanted = ref.sheet.trim().toLowerCase();
		const match = sheets.find((sheet) => sheet.name.toLowerCase() === wanted);
		if (!match) {
			toast.info(`There is no sheet called “${ref.sheet}” any more.`);
			return;
		}

		/*
		 * A reference written earlier in the conversation points at where a cell
		 * *was*. Remove a column and yesterday's `H33` is today's `G33` — and if
		 * the sheet has since become narrower than the reference, following it
		 * used to select nothing at all and say nothing about why. A link that
		 * does nothing when clicked is the worst of the three options; being
		 * told it has gone out of date is the least bad.
		 */
		const row = Math.max(ref.from.row, 0);
		const column = Math.max(ref.from.column, 0);
		if (column >= match.columns.length || row >= match.rows.length) {
			toast.info(
				`That link points outside “${match.name}” as it is now — it was written before the sheet changed shape.`
			);
			return;
		}

		view = 'workbook';
		activeId = match.id;
		selected = { row, column };

		// A reference to one cell is a cursor, not a region. Highlighting it as a
		// range put the inspector into its block mode — "1 × 1 block, sum 0.2" —
		// in place of the value, type, source text and confidence, which is the
		// entire reason for following the reference.
		const single =
			ref.kind === 'cell' || (ref.from.row === ref.to.row && ref.from.column === ref.to.column);
		range = single ? null : ref;
	}

	/** Following a reference out of the agent's prose into the sheet. */
	$effect(() => {
		const request = reveal;
		if (request) focusRef(request.ref);
	});

	/**
	 * The same, for references inside the workbook notes.
	 *
	 * The notes are the agent's own prose and it writes `[[Sheet!D3]]` in them
	 * exactly as it does in the conversation — they were rendering as literal
	 * brackets here, which is worse than not offering the syntax at all. The
	 * popover portals out of this subtree, so it carries its own handler rather
	 * than relying on the one over the conversation column.
	 */
	function onNoteClick(event: MouseEvent) {
		const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-ref]');
		const raw = target?.dataset.ref;
		if (!raw) return;
		const ref = parseRef(raw);
		if (!ref) return;
		event.preventDefault();
		focusRef(ref);
	}

	type View = 'workbook' | 'source' | 'split';
	let view = $state<View>('workbook');
	/**
	 * Once the source has been opened it stays mounted, hidden, so switching
	 * back does not re-fetch the page data or throw away pages already drawn.
	 * It is not mounted before that: a reader who never opens it should not pay
	 * for the blocks of a forty-page document.
	 */
	let sourceUsed = $state(false);
	$effect(() => {
		if (view !== 'workbook') sourceUsed = true;
	});

	/** Height of the docked source, in pixels. Dragged, and remembered. */
	const DOCK = { min: 180, max: 900, initial: 340 };
	let dockHeight = $state(DOCK.initial);
	let dragging = $state(false);

	function startDock(event: PointerEvent) {
		event.preventDefault();
		dragging = true;
		const startY = event.clientY;
		const startHeight = dockHeight;
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);

		const move = (moved: PointerEvent) => {
			// Dragging the handle up makes the source taller, which is why this
			// subtracts: the dock grows from the bottom edge of the pane.
			const wanted = startHeight - (moved.clientY - startY);
			const room = pane ? pane.clientHeight - 160 : DOCK.max;
			dockHeight = Math.min(Math.max(wanted, DOCK.min), Math.min(DOCK.max, room));
		};
		const done = () => {
			dragging = false;
			target.releasePointerCapture(event.pointerId);
			target.removeEventListener('pointermove', move);
			target.removeEventListener('pointerup', done);
			try {
				localStorage.setItem('rowbot:dock', String(Math.round(dockHeight)));
			} catch {
				// Private browsing refuses writes; the dock just won't be remembered.
			}
		};
		target.addEventListener('pointermove', move);
		target.addEventListener('pointerup', done);
	}

	onMount(() => {
		const held = Number(localStorage.getItem('rowbot:dock'));
		if (Number.isFinite(held) && held >= DOCK.min) dockHeight = Math.min(held, DOCK.max);
	});

	/** Keyboard equivalent of the drag, for the splitter's ARIA contract. */
	function nudgeDock(event: KeyboardEvent) {
		const step = event.shiftKey ? 64 : 16;
		const by = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0;
		if (!by) return;
		event.preventDefault();
		dockHeight = Math.min(Math.max(dockHeight + by, DOCK.min), DOCK.max);
	}

	let activeId = $state<string | null>(null);
	let heat = $state(false);
	let selected = $state<{ row: number; column: number } | null>(null);

	/**
	 * A request to reveal a region on the page. The nonce is what makes
	 * clicking the same cell twice scroll to it again — without it the effect
	 * on the other side sees no change and does nothing.
	 */
	let focus = $state<SourceFocus | null>(null);
	let nonce = 0;

	/**
	 * What "add to chat" sends: the highlighted row or column if there is one,
	 * otherwise the single selected cell.
	 */
	function attachable(): SheetRef {
		if (range) return range;
		const at = { row: selected?.row ?? 0, column: selected?.column ?? 0 };
		const shape = { kind: 'cell' as const, from: at, to: { ...at } };
		return { sheet: active?.name ?? '', ...shape, raw: formatRef(active?.name ?? '', shape) };
	}

	/**
	 * The reverse crossing: from the sheet to the block on the page.
	 *
	 * A sheet stitched from five pages has five blocks, so it shows the one the
	 * selected row actually came from. Asking "where did this come from?" on
	 * row 100 and being shown page 2 is the kind of near-miss that makes a
	 * reviewer stop trusting the link.
	 */
	function showOnPage() {
		if (!active) return;
		const row = selected?.row ?? range?.from.row;
		const origin = originForRow(active, row);
		if (!origin) return;

		// The cell's own text, so the page can be narrowed to the figure rather
		// than to the table it sat in. Both the typed value and what the reader
		// saw, because the page printed one and the workbook holds the other.
		const cell = selected ? active.rows[selected.row]?.[selected.column] : undefined;

		focus = {
			tablePath: origin.tablePath,
			nonce: ++nonce,
			cell: cell
				? {
						text: cell.v == null ? '' : String(cell.v),
						raw: cell.raw,
						row: origin.rowInTable,
						rows: origin.rowsInTable
					}
				: undefined
		};
		// Somebody who has docked the page wants to keep seeing the workbook;
		// only the tabbed view needs to switch to show them the page at all.
		if (view !== 'split') view = 'source';
	}

	/**
	 * Crossing from a block on the page to the sheet it became. Both sides
	 * name the table by the same workspace path, so this is a lookup rather
	 * than a guess.
	 */
	function openTable(path: string) {
		const first = sheets.find((sheet) => sheet.source?.tablePath === path);
		if (first) {
			activeId = first.id;
			selected = null;
			range = null;
			view = 'workbook';
			return;
		}

		// A table that continued across a page break is not a sheet of its own —
		// its rows were appended to the sheet the first page made. Landing at the
		// top of a 130-row ledger would be true but useless, so this selects the
		// first row that page contributed and the grid scrolls there.
		const stitched = sheets.find((sheet) => sheet.continuedFrom?.includes(path));
		if (!stitched) return;
		activeId = stitched.id;
		range = null;
		view = 'workbook';
		const at = stitched.continuedAt?.[stitched.continuedFrom?.indexOf(path) ?? -1];
		selected = at === undefined ? null : { row: at, column: 0 };
	}

	const sheets = $derived(workbook?.sheets ?? []);

	/* ── History ──────────────────────────────────────────────────────
	   Loaded when the popover opens rather than with the page: it is a thing
	   you go and look at occasionally, and a query on every workspace load to
	   populate a list nobody opened is a query for nothing. */

	interface Revision {
		version: number;
		summary: string | null;
		at: string;
	}

	let revisions = $state<Revision[] | null>(null);
	let historyError = $state<string | null>(null);
	let restoring = $state<number | null>(null);

	async function loadHistory() {
		revisions = null;
		historyError = null;
		try {
			const response = await fetch(`/api/workbook/${documentId}`);
			if (!response.ok) throw new Error('Could not read this workbook’s history.');
			revisions = (await response.json()).revisions ?? [];
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : 'Could not read the history.';
		}
	}

	async function restore(version: number) {
		if (restoring !== null) return;
		restoring = version;
		try {
			const response = await fetch(`/api/workbook/${documentId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ version })
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				toast.error(payload?.message ?? 'Could not go back to that version.');
				return;
			}
			onedited?.(payload.workbook as WorkbookModel);
			toast.success(`Back to version ${version}. It is saved as the newest one.`);
			await loadHistory();
		} finally {
			restoring = null;
		}
	}

	/**
	 * Notes the agent left on individual sheets.
	 *
	 * These were written, exported into the .xlsx as a comment on A1, and shown
	 * nowhere in the app — so the units a column is in, or the footnote that
	 * explains a blank, only reached a reviewer who downloaded the file and
	 * hovered the right cell. They belong next to the workbook's own note.
	 */
	const sheetNotes = $derived(sheets.filter((sheet) => sheet.notes?.trim()));
	const hasNotes = $derived(Boolean(workbook?.notes?.trim()) || sheetNotes.length > 0);
	const active = $derived(sheets.find((s) => s.id === activeId) ?? sheets[0]);

	/* ── Reading direction ────────────────────────────────────────────
	   Offered only where it could plausibly be wrong: a sheet with no
	   right-to-left characters in it has nothing to decide. */

	const rtlNow = $derived(active ? isRightToLeft(active) : false);
	const looksBidi = $derived(
		active ? rtlNow || isRightToLeft({ rows: active.rows }) || active.direction === 'ltr' : false
	);

	let flipping = $state(false);

	async function flipDirection() {
		if (!active || flipping) return;
		flipping = true;
		const next = rtlNow ? 'ltr' : 'rtl';
		try {
			const response = await fetch(`/api/workbook/${documentId}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sheetId: active.id, direction: next })
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				toast.error(payload?.message ?? 'Could not change the reading direction.');
				return;
			}
			onedited?.(payload.workbook as WorkbookModel);
			toast.success(
				next === 'rtl'
					? 'Reading right to left. The exported file will open that way too.'
					: 'Reading left to right. The exported file will open that way too.'
			);
		} finally {
			flipping = false;
		}
	}

	/**
	 * Which sheet to show when nothing is showing.
	 *
	 * The first one — the main table the document is about. This used to take
	 * `sheets.at(-1)`, reading as "follow the agent to the sheet it just made",
	 * but the condition only fires when the selected sheet is *absent*, which on
	 * a reopened project means no sheet has been selected at all. So coming back
	 * to a ledger of four hundred rows opened on the seven-row summary sitting
	 * behind it, every time.
	 */
	$effect(() => {
		const first = sheets[0];
		if (first && !sheets.some((s) => s.id === activeId)) {
			activeId = first.id;
			selected = null;
		}
	});

	/**
	 * Paths of OCR tables that made it into the workbook, for the overlay.
	 *
	 * Continuations count. A ledger running over five pages is one sheet built
	 * from five tables, and marking only the first page's block as linked left
	 * the other four looking like tables Rowbot had skipped.
	 */
	const linkedPaths = $derived(
		sheets
			.flatMap((sheet) => [sheet.source?.tablePath, ...(sheet.continuedFrom ?? [])])
			.filter((path): path is string => Boolean(path))
	);

	/** Totals whose arithmetic did not agree with the page. */
	const mismatches = $derived(
		active?.rows.reduce(
			(total, row) => total + row.filter((c) => c.check?.status === 'mismatch').length,
			0
		) ?? 0
	);

	/**
	 * The least confident cell in the sheet, which is what the control shows.
	 *
	 * A count of cells under a threshold was here before and it was always
	 * zero — see `confidence.ts`. The worst single reading is the honest
	 * summary: it colours the button, so a green thermometer means there is
	 * nothing in this sheet worth opening the map for, and anything warmer
	 * means there is.
	 */
	const gradient = confidenceGradient();

	const worstConfidence = $derived.by(() => {
		let worst: number | undefined;
		for (const row of active?.rows ?? []) {
			for (const cell of row) {
				if (cell.conf === undefined || cell.covered) continue;
				if (worst === undefined || cell.conf < worst) worst = cell.conf;
			}
		}
		return worst;
	});
</script>

<div bind:this={pane} class="flex h-full min-w-0 flex-col bg-rail">
	<!-- ── View switcher ───────────────────────────────────────────────
	     The workbook and the page it came from are two readings of the same
	     document, so they are peers here rather than one being buried behind
	     a button on the other. -->
	<div class="scroll-slim flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b px-3">
		<div class="flex shrink-0 items-center gap-0.5 rounded-lg bg-foreground/[0.045] p-0.5">
			{#each [{ id: 'workbook', label: 'Workbook', icon: FileSpreadsheetIcon }, { id: 'source', label: 'Source', icon: File01Icon }] as const as tab (tab.id)}
				<button
					type="button"
					class={cn(
						'flex items-center gap-1.5 rounded-[0.4rem] px-2.5 py-1 text-[0.8125rem] font-medium transition-colors',
						view === tab.id
							? 'bg-card text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					)}
					aria-pressed={view === tab.id}
					onclick={() => (view = tab.id)}
				>
					<Icon icon={tab.icon} size={14} />
					{tab.label}
				</button>
			{/each}

			<!-- Split, beside the two it splits. A third tab would say the pane can
			     show one of three things; this says the two can be shown at once,
			     which is what it does. -->
			<button
				type="button"
				class={cn(
					'flex items-center gap-1.5 rounded-[0.4rem] px-2 py-1 text-[0.8125rem] font-medium transition-colors',
					view === 'split'
						? 'bg-card text-foreground shadow-sm'
						: 'text-muted-foreground hover:text-foreground'
				)}
				aria-pressed={view === 'split'}
				title={view === 'split' ? 'Show one at a time' : 'Show the workbook and the page together'}
				onclick={() => (view = view === 'split' ? 'workbook' : 'split')}
			>
				<Icon icon={BorderBottom01Icon} size={14} />
				<span class="sr-only">Split the view</span>
			</button>
		</div>

		{#if view === 'workbook' && workbook?.title}
			<!--
				A minimum width, or nothing. Between the two tabs on the left and
				the four controls on the right this had no slack of its own and
				collapsed to "Calde…", which reads as a rendering fault rather than
				as a long title. Given 7rem it either says something or the toolbar
				scrolls, and below `lg` the breadcrumb is already naming the
				document.
			-->
			<span class="hidden min-w-[7rem] truncate text-sm font-medium lg:block">
				{workbook.title}
			</span>
		{/if}

		{#if view === 'workbook' && sheets.length}
			<span class="ml-auto flex shrink-0 items-center gap-1.5">
				{#if hasNotes}
					<Popover.Root>
						<Popover.Trigger>
							{#snippet child({ props })}
								<!--
									Icons, not labels. Between the two views, the notes, the
									confidence map, the export and a mismatch count that only
									appears when something is wrong, this row runs out of width
									exactly when it has the most to say. The two controls whose
									icons carry their meaning give up their words; the export,
									which is the one thing a first-time reader is looking for,
									keeps its own.
								-->
								<Button
									{...props}
									variant="ghost"
									size="icon-sm"
									class="text-muted-foreground"
									title="What Rowbot wants you to check"
									aria-label="What Rowbot wants you to check"
								>
									<Icon icon={Note01Icon} size={15} />
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content
							class="scroll-slim max-h-[60vh] w-96 overflow-y-auto text-sm leading-relaxed"
							align="end"
						>
							<p class="font-medium">What Rowbot wants you to check</p>
							<p class="mt-0.5 mb-2.5 text-xs text-muted-foreground">
								Written by the agent while it built this workbook — the judgement calls it made and
								anything it could not resolve from the page.
							</p>
							<!-- The chips inside are real buttons, so keyboard activation already
							     works; this listener only catches their click as it bubbles. -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div onclick={onNoteClick}>
								{#if workbook?.notes?.trim()}
									<!--
										Safe by construction: `renderMarkdown` escapes the model's
										output before generating any markup. See markdown.spec.ts.
									-->
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									<div class="text-muted-foreground">{@html renderMarkdown(workbook.notes)}</div>
								{/if}

								{#each sheetNotes as sheet (sheet.id)}
									<div class="mt-3 border-t pt-3 first:mt-0 first:border-0 first:pt-0">
										<button
											type="button"
											class="mb-1 block text-xs font-medium text-accent-ink"
											onclick={() => {
												activeId = sheet.id;
												view = 'workbook';
											}}
										>
											<span dir="auto">{sheet.name}</span>
										</button>
										<div class="text-muted-foreground">
											<!-- eslint-disable-next-line svelte/no-at-html-tags -->
											{@html renderMarkdown(sheet.notes ?? '')}
										</div>
									</div>
								{/each}
							</div>
						</Popover.Content>
					</Popover.Root>
				{/if}

				<!-- ── Reading direction ────────────────────────────────────
				     Only for a sheet that has anything right-to-left in it, because
				     for everything else there is nothing to decide. The reader
				     returns the columns of an RTL table in logical order for some
				     documents and in visual order for others, so the guess is right
				     most of the time and cannot be right always — and a mirrored
				     table is worse than an unflipped one. One click either way. -->
				{#if active && looksBidi}
					<Button
						variant="ghost"
						size="icon-sm"
						class={active.direction ? 'text-accent-ink hover:text-accent-ink' : ''}
						disabled={flipping}
						title={rtlNow
							? 'This sheet reads right to left — click if its columns are the wrong way round'
							: 'This sheet reads left to right — click if its columns are the wrong way round'}
						aria-label="Change which way this sheet reads"
						onclick={flipDirection}
					>
						<Icon icon={ArrowLeftRightIcon} size={15} />
					</Button>
				{/if}

				<!-- ── History ──────────────────────────────────────────────
				     Every change to this workbook has been recorded with a sentence
				     saying what it was, since the first version of the app, and none
				     of it was ever shown. A tool whose promise is that you can see
				     how it arrived at a figure should not keep its own history to
				     itself. -->
				<Popover.Root onOpenChange={(open) => open && loadHistory()}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-sm"
								title="Every version of this workbook"
								aria-label="Every version of this workbook"
							>
								<Icon icon={Clock01Icon} size={15} />
							</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content class="w-96 text-sm" align="end">
						<p class="font-medium">Every version of this workbook</p>
						<p class="mt-0.5 mb-2.5 text-xs leading-relaxed text-muted-foreground">
							Each turn, and each of your own corrections, kept its own copy. Going back to one adds
							it as a new version rather than throwing the others away.
						</p>

						{#if historyError}
							<p class="text-xs text-destructive">{historyError}</p>
						{:else if !revisions}
							<p class="text-xs text-muted-foreground">Looking…</p>
						{:else if !revisions.length}
							<p class="text-xs text-muted-foreground">Nothing has been saved yet.</p>
						{:else}
							<ol class="scroll-slim -mx-1 max-h-[50vh] space-y-px overflow-y-auto">
								{#each revisions as revision (revision.version)}
									{@const current = revision.version === revisions[0].version}
									<li
										class="group/rev flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent/50"
									>
										<span
											class="mt-px w-8 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums"
										>
											v{revision.version}
										</span>
										<span class="min-w-0 flex-1">
											<!-- No `block` beside `line-clamp`: the clamp needs
											     `display: -webkit-box` and `block` was overwriting it,
											     which is why the older entries still ran to five lines. -->
											<span class="line-clamp-2 text-[0.8125rem] leading-snug">
												{revision.summary ?? 'A change with no note'}
											</span>
											<span class="mt-0.5 block text-[11px] text-muted-foreground">
												{timeAgo(revision.at)}{current ? ' · current' : ''}
											</span>
										</span>
										{#if !current}
											<button
												type="button"
												class="mt-px shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-accent-ink opacity-0 transition-opacity group-hover/rev:opacity-100 focus-visible:opacity-100"
												disabled={restoring !== null}
												onclick={() => restore(revision.version)}
											>
												{restoring === revision.version ? 'Going back…' : 'Go back to this'}
											</button>
										{/if}
									</li>
								{/each}
							</ol>
						{/if}
					</Popover.Content>
				</Popover.Root>

				{#if mismatches > 0}
					<span
						class="flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-1 text-xs font-medium text-destructive tabular-nums"
						title="{mismatches} total{mismatches === 1
							? ' does'
							: 's do'} not match what the column adds up to"
					>
						<Icon icon={Alert01Icon} size={13} />
						{mismatches}
					</span>
				{/if}

				{#if worstConfidence !== undefined}
					<Button
						variant={heat ? 'secondary' : 'ghost'}
						size="icon-sm"
						onclick={() => (heat = !heat)}
						title={`Least confident cell in this sheet: ${(worstConfidence * 100).toFixed(1)}% — ${confidenceWords(worstConfidence)}`}
						aria-pressed={heat}
						aria-label={`Confidence map. Least confident cell ${(worstConfidence * 100).toFixed(0)} percent.`}
					>
						<!-- Coloured by the worst reading in the sheet, so the control
						     itself carries the answer to "is anything wrong here?" -->
						<Icon
							icon={ThermometerIcon}
							size={15}
							style={`color:${confidenceColor(worstConfidence)}`}
						/>
					</Button>
				{/if}

				<Button size="sm" href="/api/export/{documentId}" download class="gap-1.5">
					<Icon icon={Download04Icon} size={14} />
					.xlsx
				</Button>
			</span>
		{/if}
	</div>

	{#if view !== 'source'}
		{#if !sheets.length}
			<!--
			Three states, not two. A run that has finished and produced nothing is
			a different fact from one that has not started, and saying "sheets will
			appear once Rowbot reads the document" after it has read the document
			reads as though the app lost the result.
		-->
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
				<span
					class="flex size-12 items-center justify-center rounded-xl border bg-card text-muted-foreground"
				>
					<!-- Only the third state is a problem. A workbook that has not been
				     started yet is not a warning, and the triangle was saying it was
				     — for the whole of every run, since the icon never changed. -->
					<Icon icon={finished ? Alert01Icon : FileSpreadsheetIcon} size={22} />
				</span>
				<p class="text-sm font-medium">
					{busy ? 'Building your workbook…' : finished ? 'No table here' : 'No sheets yet'}
				</p>
				<p class="max-w-xs text-sm leading-relaxed text-muted-foreground">
					{#if busy}
						Sheets appear here the moment Rowbot creates them.
					{:else if finished}
						Rowbot read the document and did not find a table it could import. Look at what it read
						on the page, or tell it where the table is.
					{:else}
						Sheets will appear here once Rowbot reads the document.
					{/if}
				</p>
				{#if finished}
					<Button variant="outline" size="sm" class="mt-1 gap-2" onclick={() => (view = 'source')}>
						<Icon icon={File01Icon} size={15} />
						See what it read
					</Button>
				{/if}
			</div>
		{:else}
			<!--
			The sheet is a surface, not the background. Previously the grid bled to
			every edge and the inspector ran the full width beneath it, so the pane
			had no shape at all — and the inspector read as a stray strip rather
			than part of the sheet. Both now live inside one rounded card that
			shares the sheet tabs' inset, so the whole right column is a stack of
			aligned surfaces.
		-->
			<div class="min-h-0 flex-1 px-3 pt-2">
				<div
					class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm"
				>
					{#if heat}
						<!-- ── Confidence spectrum ──────────────────────────────
						     One bar rather than three swatches and a sentence. The
						     sentence wrapped onto two lines on a wide display and
						     described bands the data never fell into; the bar is the
						     scale the tint is drawn from, with the worst cell in this
						     sheet marked on it. -->
						<div
							class="flex h-8 shrink-0 items-center gap-3 border-b bg-muted/30 px-3 text-[11px] text-muted-foreground"
						>
							<span class="shrink-0">Reader confidence</span>
							<span class="shrink-0 tabular-nums opacity-70">80%</span>
							<div class="relative h-2 min-w-24 flex-1 rounded-full" style:background={gradient}>
								{#if worstConfidence !== undefined}
									<span
										class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow"
										style:inset-inline-start="{confidenceOffset(worstConfidence)}%"
										style:background={confidenceColor(worstConfidence)}
									></span>
								{/if}
							</div>
							<span class="shrink-0 tabular-nums opacity-70">100%</span>
							{#if worstConfidence !== undefined}
								<span class="ml-auto shrink-0 whitespace-nowrap">
									lowest <strong class="font-medium" style:color={confidenceColor(worstConfidence)}>
										{(worstConfidence * 100).toFixed(1)}%
									</strong>
								</span>
							{/if}
						</div>
					{/if}

					<div class="min-h-0 flex-1">
						{#if active}
							{#key active.id}
								<SheetGrid
									bind:this={grid}
									sheet={active}
									{heat}
									onedit={saveCell}
									locked={busy
										? 'Rowbot is still working — wait for it to finish before editing.'
										: undefined}
									bind:selected
									bind:range
								/>
							{/key}
						{/if}
					</div>

					{#if active}
						<!-- A cell's note is the agent's prose too, and it writes references
					     there. Same delegated handler as the workbook notes. -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div onclick={onNoteClick}>
							<CellInspector
								sheet={active}
								{selected}
								{range}
								onshowsource={showOnPage}
								onattach={onattach ? () => onattach(attachable()) : undefined}
							/>
						</div>
					{/if}
				</div>
			</div>

			<!-- Sheet tabs, at the bottom where a spreadsheet puts them.
		     The wrapper's padding is the composer's exactly, so the agent column
		     and the workbook column finish on the same line instead of one
		     floating above the edge while the other runs into it. -->
			<div class="shrink-0 px-3 pt-2 pb-3">
				<div
					class="scroll-slim flex h-10 items-center gap-1 overflow-x-auto rounded-xl border bg-card px-1.5 shadow-sm"
				>
					{#each sheets as sheet (sheet.id)}
						<button
							type="button"
							class={cn(
								'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors',
								sheet.id === active?.id
									? 'bg-secondary text-foreground'
									: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
							)}
							aria-current={sheet.id === active?.id ? 'true' : undefined}
							onclick={() => {
								activeId = sheet.id;
								selected = null;
							}}
						>
							<!-- The name resolves its own direction; the row count stays put
						     beside it rather than being dragged to the other end. -->
							<span dir="auto">{sheet.name}</span>
							<span class="text-[11px] text-muted-foreground tabular-nums">
								{Math.max(sheet.rows.length - sheet.headerRows, 0)}
							</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	{/if}

	<!-- ── The page, docked ────────────────────────────────────────────
	     The workbook and the page it came from are two readings of one
	     document, and checking a figure against its source means having both
	     in front of you. Split shows them together; the tabs above still
	     maximise either one.

	     Mounted once used and then hidden rather than removed, so switching
	     back does not re-fetch the page data or throw away pages already
	     drawn — and never mounted at all for a reader who stays in the grid. -->
	{#if view === 'split'}
		<!-- The window-splitter pattern: a focusable `separator` is exactly what
		     WAI-ARIA prescribes here, which the linter has no way to tell from a
		     decorative rule. Same pair of waivers as `resize-edge.svelte`. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize the page panel"
			aria-valuenow={Math.round(dockHeight)}
			aria-valuemin={DOCK.min}
			aria-valuemax={DOCK.max}
			tabindex="0"
			onpointerdown={startDock}
			onkeydown={nudgeDock}
			class={cn(
				'relative h-1.5 shrink-0 cursor-row-resize touch-none',
				'before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-border',
				'after:absolute after:inset-x-0 after:top-1/2 after:h-0.5 after:-translate-y-1/2 after:bg-primary after:opacity-0 after:transition-opacity',
				'hover:after:opacity-60 focus-visible:outline-none focus-visible:after:opacity-100',
				dragging && 'after:opacity-100'
			)}
		></div>
	{/if}

	{#if sourceUsed}
		<div
			class={cn('min-h-0', view === 'source' ? 'flex-1' : view === 'split' ? 'shrink-0' : 'hidden')}
			style:height={view === 'split' ? `${dockHeight}px` : undefined}
		>
			<SourceView {documentId} {mimeType} {linkedPaths} {focus} onopentable={openTable} />
		</div>
	{/if}
</div>
