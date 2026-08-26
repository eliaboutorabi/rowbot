<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/icon.svelte';
	import {
		Alert01Icon,
		ArrowRight01Icon,
		Cancel01Icon,
		Key01Icon,
		RefreshIcon,
		FileSpreadsheetIcon,
		Message01Icon,
		Calculator01Icon,
		SearchVisualIcon,
		QuestionIcon,
		Download04Icon
	} from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import Activity from '$lib/components/agent/activity.svelte';
	import Composer from '$lib/components/agent/composer.svelte';
	import WorkbookView from '$lib/components/grid/workbook-view.svelte';
	import Logo from '$lib/components/brand/logo.svelte';
	import Suggestions, { type Suggestion } from '$lib/components/agent/suggestions.svelte';
	import type { IconSvgElement } from '@hugeicons/svelte';
	import { RunState, type TimelineItem } from '$lib/stores/run.svelte';
	import { sidebar } from '$lib/stores/sidebar.svelte';
	import { activity } from '$lib/stores/activity.svelte';
	import { widths } from '$lib/stores/layout.svelte';
	import ResizeEdge from '$lib/components/app/resize-edge.svelte';
	import { fileSize } from '$lib/format';
	import { describeRunFailure } from '$lib/run-error';
	import { parseRef, type SheetRef } from '$lib/sheet-ref';
	import { cn } from '$lib/utils';
	import type { TodoItem } from '$lib/types/events';
	import type { WorkbookModel } from '$lib/types/workbook';

	/**
	 * Keyed on the document id by the route, so every document gets a fresh
	 * run, model choice and transcript rather than inheriting the last one's.
	 */
	interface WorkspaceData {
		document: {
			id: string;
			name: string;
			originalFilename: string;
			mimeType: string;
			sizeBytes: number;
		};
		workbook: WorkbookModel | null;
		/** The previous run, rebuilt from its checkpoint. */
		transcript: {
			items: TimelineItem[];
			todos: TodoItem[];
			interrupt: { id: string; question: string; payload: unknown } | null;
		} | null;
		runStatus: string | null;
		runError: string | null;
		preferences: { model: string; effort: string };
	}

	let { data }: { data: WorkspaceData } = $props();

	// These deliberately snapshot the initial load: the route keys this
	// component on the document id, and the user's later model choice must not
	// be reverted by an unrelated `invalidate`.
	/* svelte-ignore state_referenced_locally */
	const run = new RunState(data.workbook);
	/* svelte-ignore state_referenced_locally */
	if (data.transcript) {
		run.restore(data.transcript.items, data.transcript.todos);
		// A run parked on a question comes back still parked on it. Without this
		// the feed returned, the question did not, and the only thing the
		// composer would send was a new message the graph could not accept.
		if (data.transcript.interrupt) run.interrupt = data.transcript.interrupt;
	}

	/*
	 * A run that died leaves a note saying so.
	 *
	 * Not the red panel: that is for something that just happened in front of
	 * you and might still be retried in the same breath. This is a line in the
	 * feed, where the rest of the run's story is, saying the story stops here —
	 * and it matters because the workbook below may be half-built and nothing
	 * else on the page would say so.
	 */
	/* svelte-ignore state_referenced_locally */
	if (data.runStatus === 'failed' && !data.transcript?.interrupt) {
		run.note(
			`The last run stopped before it finished${data.runError ? `: ${describeRunFailure(data.runError).title}` : '.'} Anything it had built by then is saved below.`
		);
	}
	/* svelte-ignore state_referenced_locally */
	let model = $state(data.preferences.model);
	/* svelte-ignore state_referenced_locally */
	let effort = $state(data.preferences.effort);

	const START_PROMPT =
		'Convert every table in this document into a clean, well-named workbook. Verify what you build and tell me about anything you were unsure of.';

	function send(message: string) {
		lastSent = message;
		run.send({ documentId: data.document.id, message, model, effort });
	}

	/**
	 * Kept so a failed turn can be sent again without the reviewer retyping it.
	 * The thread is checkpointed and repaired before each turn, so this really
	 * does resume rather than start over.
	 */
	let lastSent = $state<string | null>(null);

	function retry() {
		if (!lastSent || run.busy) return;
		run.error = null;
		run.outOfAllowance = false;
		send(lastSent);
	}

	function resume(value: unknown) {
		run.send({ documentId: data.document.id, resume: value, model, effort });
	}

	/**
	 * What to offer on a document nobody has asked anything about yet.
	 *
	 * This used to fire `START_PROMPT` by itself the instant the workspace
	 * opened, which decided the first turn for the reviewer and started
	 * spending on a document they might only have wanted to look at. Two
	 * openings, and they pick.
	 */
	const OPENING: Suggestion[] = [
		{
			label: 'Turn it into a workbook',
			prompt: START_PROMPT,
			icon: FileSpreadsheetIcon
		},
		{
			label: 'Check it for numerical mistakes',
			prompt:
				'Read this document and check its arithmetic: every column that is summed, every ' +
				'total, and every figure derived from other figures on the page. Tell me what does ' +
				'not add up, and where on the page each problem is.',
			icon: Calculator01Icon
		}
	];

	/**
	 * What usually comes next, written for this workbook rather than fixed.
	 *
	 * A fixed list reads badly the moment you look at it: "re-check against the
	 * pages" on a workbook whose every figure already reconciles is noise, and
	 * the one thing worth asking — the figure the reader was unsure of, the
	 * detail block nobody has pulled out yet — is exactly what a fixed list
	 * cannot know about. So they are asked for, from the workbook's own shape
	 * and the agent's closing words.
	 *
	 * The fallback below is what shows if that request fails or is still in
	 * flight. It has to be something, and these three are true of any workbook.
	 */
	const ICONS: Record<string, IconSvgElement> = {
		check: SearchVisualIcon,
		explain: QuestionIcon,
		edit: FileSpreadsheetIcon,
		export: Download04Icon
	};

	const FALLBACK: Suggestion[] = [
		{
			label: 'Re-check against the pages',
			prompt: 'Re-check every sheet against the source pages and fix anything wrong.',
			icon: SearchVisualIcon
		},
		{
			label: 'Pull out the details',
			prompt:
				'Collect everything on the pages that is not part of a table — names, ' +
				'addresses, reference numbers, dates, terms, account details — into one ' +
				'extra sheet called Details, as label and value pairs, and say which page ' +
				'each came from.',
			icon: FileSpreadsheetIcon
		},
		{
			label: 'What were you least sure about?',
			prompt:
				'Which figures were you least sure of, and why? Point me at the ones worth ' +
				'checking by hand.',
			icon: QuestionIcon
		}
	];

	let written = $state<Suggestion[] | null>(null);
	let askedFor = $state<string | null>(null);
	const followUp = $derived(written ?? FALLBACK);

	/**
	 * Fetched when a turn finishes, keyed on what the workbook looks like now,
	 * so a second turn that changes nothing does not pay for a second call.
	 */
	$effect(() => {
		if (run.busy || !run.workbook?.sheets.length) return;
		const key = `${run.workbook.sheets.length}:${run.timeline.length}`;
		if (askedFor === key) return;
		askedFor = key;

		fetch(`/api/suggestions/${data.document.id}`)
			.then((response) => (response.ok ? response.json() : null))
			.then((body) => {
				const items = body?.suggestions;
				if (!Array.isArray(items) || !items.length) return;
				written = items
					.filter((item) => item?.label && item?.prompt)
					.map((item) => ({
						label: String(item.label),
						prompt: String(item.prompt),
						icon: ICONS[item.kind] ?? QuestionIcon
					}));
			})
			.catch(() => {
				// The fallback is already on screen. Nothing to report.
			});
	});

	const canStart = $derived(!run.busy && run.timeline.length === 0 && !run.workbook);
	const failure = $derived(run.error ? describeRunFailure(run.error) : null);

	/**
	 * The agent column is the point of the app, but a wide workbook needs the
	 * whole screen sometimes. Collapsed it becomes a rail rather than
	 * disappearing, so the way back is always visible — and the rail itself is
	 * the way back. The other one is in the nav bar, which is where a control
	 * that shows and hides a whole panel belongs; it was costing a 36px row
	 * inside the panel it hides.
	 */
	const collapsed = $derived(sidebar.open !== 'chat');

	/** True while the conversation's edge is being dragged. */
	let dragging = $state(false);

	/**
	 * Keep the rail's conversation button informed. It shows what the collapsed
	 * panel used to show on a rail of its own, which the app rail has made
	 * redundant.
	 */
	$effect(() => {
		activity.report({
			busy: run.busy,
			failed: Boolean(run.error),
			done: run.todos.filter((todo) => todo.status === 'completed').length,
			total: run.todos.length
		});
		return () => activity.clear();
	});

	/**
	 * On a phone the two columns cannot both be on screen — stacked, each got
	 * half a viewport and neither was usable. Below `lg` exactly one shows at a
	 * time and a segmented control switches between them, which is what the
	 * layout was always trying to be.
	 */
	let pane = $state<'chat' | 'workbook'>('chat');

	/** References attached to the next message, picked out of the sheet. */
	let attachments = $state<SheetRef[]>([]);

	/** A reference the agent wrote, to reveal in the grid. */
	let reveal = $state<{ ref: SheetRef; nonce: number } | null>(null);
	let revealNonce = 0;

	function attach(ref: SheetRef) {
		if (attachments.some((existing) => existing.raw === ref.raw)) return;
		attachments = [...attachments, ref];
	}

	/**
	 * The agent's prose is injected as HTML, so its reference chips cannot carry
	 * Svelte handlers. One delegated listener on the column reads `data-ref` off
	 * whatever was clicked.
	 */
	function onFeedClick(event: MouseEvent) {
		const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-ref]');
		const raw = target?.dataset.ref;
		if (!raw) return;
		const ref = parseRef(raw);
		if (!ref) return;
		event.preventDefault();
		reveal = { ref, nonce: ++revealNonce };
	}
</script>

<svelte:head><title>{data.document.name} · Rowbot</title></svelte:head>

<div class="flex h-full min-h-0 flex-col">
	<!-- Phone only: one pane at a time. -->
	<div class="flex shrink-0 items-center gap-1 border-b bg-rail px-3 py-2 lg:hidden">
		<div class="flex flex-1 items-center gap-0.5 rounded-lg bg-foreground/[0.045] p-0.5">
			{#each [{ id: 'chat', label: 'Rowbot', icon: Message01Icon }, { id: 'workbook', label: 'Workbook', icon: FileSpreadsheetIcon }] as const as tab (tab.id)}
				<button
					type="button"
					class={cn(
						'flex flex-1 items-center justify-center gap-1.5 rounded-[0.4rem] py-1.5 text-[0.8125rem] font-medium transition-colors',
						pane === tab.id
							? 'bg-card text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					)}
					aria-pressed={pane === tab.id}
					onclick={() => (pane = tab.id)}
				>
					<Icon icon={tab.icon} size={14} />
					{tab.label}
					{#if tab.id === 'chat' && run.busy}
						<span class="size-1.5 animate-pulse rounded-full bg-primary"></span>
					{:else if tab.id === 'workbook' && run.workbook?.sheets.length}
						<span class="text-[11px] text-muted-foreground tabular-nums">
							{run.workbook.sheets.length}
						</span>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<div
		class={cn(
			'grid min-h-0 flex-1 grid-cols-1 lg:transition-[grid-template-columns] lg:duration-200 lg:ease-out',
			collapsed ? 'lg:grid-cols-[0px_1fr]' : 'lg:grid-cols-[var(--chat-width)_1fr]',
			// Two length tracks, so the browser can interpolate between them and
			// the column slides rather than vanishing between frames. `0fr` or a
			// dropped track would both be instant, and the conversation appearing
			// out of nowhere is most of what made this feel abrupt.
			//
			// While the edge is being dragged the transition is off: two hundred
			// milliseconds of easing behind every pointer move is a column that
			// lags the cursor.
			dragging && 'lg:transition-none'
		)}
		style:--chat-width="{widths.chat}px"
	>
		<!-- Harness -->
		<!-- The chips inside are real buttons, so keyboard activation already works;
	     this listener only catches their click as it bubbles. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<section
			class={cn(
				'relative min-h-0 min-w-0 flex-col overflow-hidden bg-rail lg:flex',
				// The rule goes with the column: at zero width a border is a stray
				// vertical line beside the rail.
				collapsed ? 'lg:border-r-0' : 'border-r',
				pane === 'chat' ? 'flex' : 'hidden'
			)}
			inert={collapsed && pane !== 'chat'}
			aria-label="Agent activity"
			onclick={onFeedClick}
		>
			{#if !collapsed}
				<div class="hidden lg:block">
					<ResizeEdge column="chat" ondragging={(active) => (dragging = active)} />
				</div>
			{/if}

			<Activity {run}>
				{#snippet empty()}
					<div class="flex flex-col items-center gap-5 px-4 py-12 text-center">
						<!-- The mark, at a size that reads as a greeting rather than as a
						     bullet point. The soft disc behind it stops it floating. -->
						<span
							class="flex size-16 items-center justify-center rounded-2xl bg-primary/[0.07] text-accent-ink ring-1 ring-primary/15 dark:bg-primary/15 dark:ring-primary/25"
						>
							<Logo class="size-9" />
						</span>
						<div class="space-y-1.5">
							<p class="text-base font-medium">What shall I do with this?</p>
							<p class="max-w-xs text-sm text-muted-foreground">
								{data.document.originalFilename} · {fileSize(data.document.sizeBytes)}
							</p>
						</div>
						{#if canStart}
							<Suggestions items={OPENING} onpick={send} disabled={run.busy} class="max-w-sm" />
						{/if}
					</div>
				{/snippet}
			</Activity>

			<!-- ── What next ───────────────────────────────────────────────
			     Offered once a turn has finished and there is a workbook to talk
			     about, and taken away the moment another turn starts. Not shown
			     on a failed turn: the thing to do there is the retry button, and
			     three cheerful suggestions under an error read badly. -->
			{#if !run.busy && !failure && run.workbook?.sheets.length}
				<div class="shrink-0 border-t px-3 py-2">
					<Suggestions items={followUp} onpick={send} size="sm" class="justify-start" />
				</div>
			{/if}

			<!-- ── Failure ─────────────────────────────────────────────────
			     A run failure is a notice, not a wall. Printing the raw text of
			     one straight into the column pushed the conversation off the top
			     of the screen, spilled unbroken JSON out past the panel edge, and
			     offered no way out — the reviewer was left with a broken-looking
			     app and a workbook they could no longer see. So: a sentence they
			     can act on, the original kept behind a disclosure that scrolls
			     inside its own box, and a close button. -->
			{#if failure}
				<div class="shrink-0 border-t px-3 py-2.5">
					<div
						class="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-sm"
						role="alert"
					>
						<Icon
							icon={run.outOfAllowance ? Key01Icon : Alert01Icon}
							size={16}
							class="mt-0.5 shrink-0 text-destructive"
						/>
						<div class="min-w-0 flex-1 space-y-2">
							<p class="text-destructive">{failure.title}</p>
							{#if failure.hint}
								<p class="text-[0.8125rem] leading-relaxed text-muted-foreground">
									{failure.hint}
								</p>
							{/if}

							{#if run.outOfAllowance}
								<Button href={resolve('/settings')} variant="outline" size="sm">
									Add your API keys
								</Button>
							{:else if failure.retryable && lastSent}
								<Button variant="outline" size="sm" class="gap-2" onclick={retry}>
									<Icon icon={RefreshIcon} size={14} />
									Try that again
								</Button>
							{/if}

							{#if failure.detail}
								<details class="group/detail">
									<summary
										class="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
									>
										<Icon
											icon={ArrowRight01Icon}
											size={12}
											class="transition-transform group-open/detail:rotate-90"
										/>
										What went wrong, in full
									</summary>
									<!-- `break-all` rather than `break-words`: the thing that
									     overflowed was a 3,000-character line of JSON and a URL,
									     neither of which contains a space to wrap at. -->
									<pre
										class="scroll-slim mt-1.5 max-h-40 overflow-auto rounded-md bg-foreground/[0.04] p-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">{failure.detail}</pre>
								</details>
							{/if}
						</div>

						<button
							type="button"
							class="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
							aria-label="Dismiss this error"
							onclick={() => {
								run.error = null;
								run.outOfAllowance = false;
							}}
						>
							<Icon icon={Cancel01Icon} size={14} />
						</button>
					</div>
				</div>
			{/if}

			<Composer {run} bind:model bind:effort bind:attachments onsend={send} onresume={resume} />
		</section>

		<!-- Workbook -->
		<section
			class={cn('min-h-0 min-w-0 lg:block', pane === 'workbook' ? 'block' : 'hidden')}
			aria-label="Workbook preview"
		>
			<WorkbookView
				workbook={run.workbook}
				documentId={data.document.id}
				mimeType={data.document.mimeType}
				filename={data.document.originalFilename}
				readVersion={run.readVersion}
				busy={run.busy}
				finished={!run.busy && run.timeline.some((item) => item.kind === 'assistant')}
				{reveal}
				onattach={attach}
				onedited={(next) => (run.workbook = next)}
			/>
		</section>
	</div>
</div>
