<script lang="ts">
	import { resolve } from '$app/paths';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Alert01Icon,
		ArrowRight01Icon,
		Cancel01Icon,
		Key01Icon,
		PlayIcon,
		RefreshIcon,
		FileSpreadsheetIcon,
		Message01Icon
	} from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import Activity from '$lib/components/agent/activity.svelte';
	import Composer from '$lib/components/agent/composer.svelte';
	import WorkbookView from '$lib/components/grid/workbook-view.svelte';
	import Logo from '$lib/components/brand/logo.svelte';
	import { RunState, type TimelineItem } from '$lib/stores/run.svelte';
	import { sidebar } from '$lib/stores/sidebar.svelte';
	import { activity } from '$lib/stores/activity.svelte';
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
		transcript: { items: TimelineItem[]; todos: TodoItem[] } | null;
		autoStart: boolean;
		preferences: { model: string; effort: string };
	}

	let { data }: { data: WorkspaceData } = $props();

	// These deliberately snapshot the initial load: the route keys this
	// component on the document id, and the user's later model choice must not
	// be reverted by an unrelated `invalidate`.
	/* svelte-ignore state_referenced_locally */
	const run = new RunState(data.workbook);
	/* svelte-ignore state_referenced_locally */
	if (data.transcript) run.restore(data.transcript.items, data.transcript.todos);
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

	// A document that has never been run starts as soon as the workspace opens.
	let autoStarted = false;
	$effect(() => {
		if (autoStarted || !data.autoStart || run.busy) return;
		autoStarted = true;
		send(START_PROMPT);
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
					<HugeiconsIcon icon={tab.icon} size={14} />
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
			// Two length tracks, so the browser can interpolate between them and
			// the column slides rather than vanishing between frames. `0fr` or a
			// dropped track would both be instant, and the conversation appearing
			// out of nowhere is most of what made this feel abrupt.
			collapsed ? 'lg:grid-cols-[0px_1fr]' : 'lg:grid-cols-[clamp(21rem,26vw,30rem)_1fr]'
		)}
	>
		<!-- Harness -->
		<!-- The chips inside are real buttons, so keyboard activation already works;
	     this listener only catches their click as it bubbles. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<section
			class={cn(
				'min-h-0 min-w-0 flex-col overflow-hidden bg-rail lg:flex',
				// The rule goes with the column: at zero width a border is a stray
				// vertical line beside the rail.
				collapsed ? 'lg:border-r-0' : 'border-r',
				pane === 'chat' ? 'flex' : 'hidden'
			)}
			inert={collapsed && pane !== 'chat'}
			aria-label="Agent activity"
			onclick={onFeedClick}
		>
			<Activity {run}>
				{#snippet empty()}
					<div class="flex flex-col items-center gap-4 px-4 py-14 text-center">
						<Logo class="size-11 text-muted-foreground" />
						<div class="space-y-1.5">
							<p class="font-medium">Ready when you are</p>
							<p class="max-w-xs text-sm text-muted-foreground">
								{data.document.originalFilename} · {fileSize(data.document.sizeBytes)}
							</p>
						</div>
						{#if canStart}
							<Button class="mt-1 gap-2" onclick={() => send(START_PROMPT)}>
								<HugeiconsIcon icon={PlayIcon} size={15} />
								Extract the tables
							</Button>
						{/if}
					</div>
				{/snippet}
			</Activity>

			{#if !run.busy && run.workbook?.sheets.length && run.timeline.length === 0}
				<div class="shrink-0 border-t px-3 py-2">
					<Button
						variant="ghost"
						size="sm"
						class="w-full gap-2 text-muted-foreground"
						onclick={() =>
							send('Re-check every sheet against the source pages and fix anything wrong.')}
					>
						<HugeiconsIcon icon={RefreshIcon} size={14} />
						Re-check this workbook
					</Button>
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
						<HugeiconsIcon
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
									<HugeiconsIcon icon={RefreshIcon} size={14} />
									Try that again
								</Button>
							{/if}

							{#if failure.detail}
								<details class="group/detail">
									<summary
										class="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
									>
										<HugeiconsIcon
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
							<HugeiconsIcon icon={Cancel01Icon} size={14} />
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
				busy={run.busy}
				finished={!run.busy && run.timeline.some((item) => item.kind === 'assistant')}
				{reveal}
				onattach={attach}
				onedited={(next) => (run.workbook = next)}
			/>
		</section>
	</div>
</div>
