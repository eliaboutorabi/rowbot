<script lang="ts">
	import { resolve } from '$app/paths';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Alert01Icon,
		Key01Icon,
		Loading03Icon,
		PlayIcon,
		RefreshIcon,
		FileSpreadsheetIcon,
		Message01Icon,
		SidebarLeft01Icon
	} from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import Activity from '$lib/components/agent/activity.svelte';
	import Composer from '$lib/components/agent/composer.svelte';
	import WorkbookView from '$lib/components/grid/workbook-view.svelte';
	import Logo from '$lib/components/brand/logo.svelte';
	import { RunState, type TimelineItem } from '$lib/stores/run.svelte';
	import { compactNumber, fileSize } from '$lib/format';
	import { parseRef, type SheetRef } from '$lib/sheet-ref';
	import { toolMeta } from '$lib/components/agent/tool-icon';
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
		run.send({ documentId: data.document.id, message, model, effort });
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

	/**
	 * The agent column is the point of the app, but a wide workbook needs the
	 * whole screen sometimes. Collapsed it becomes a rail rather than
	 * disappearing, so the way back is always visible.
	 */
	let collapsed = $state(false);

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

	const planTotal = $derived(run.todos.length);
	const planDone = $derived(run.todos.filter((todo) => todo.status === 'completed').length);
	const totalTokens = $derived(run.usage.input + run.usage.output);
	const lastTool = $derived.by(() => {
		const item = run.timeline.findLast((entry) => entry.kind === 'tool');
		return item?.kind === 'tool' ? item.call : null;
	});
</script>

<svelte:head><title>{data.document.name} · Rowbot</title></svelte:head>

<div class="flex h-full min-h-0 flex-col">
	<!-- Phone only: one pane at a time. -->
	<div class="flex shrink-0 items-center gap-1 border-b px-3 py-2 lg:hidden">
		<div class="flex flex-1 items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
			{#each [{ id: 'chat', label: 'Rowbot', icon: Message01Icon }, { id: 'workbook', label: 'Workbook', icon: FileSpreadsheetIcon }] as const as tab (tab.id)}
				<button
					type="button"
					class={cn(
						'flex flex-1 items-center justify-center gap-1.5 rounded-[0.4rem] py-1.5 text-[0.8125rem] font-medium transition-colors',
						pane === tab.id
							? 'bg-background text-foreground shadow-sm'
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
						<span class="text-[11px] text-muted-foreground/60 tabular-nums">
							{run.workbook.sheets.length}
						</span>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<div
		class={cn(
			'grid min-h-0 flex-1 grid-cols-1 transition-[grid-template-columns] duration-200',
			collapsed ? 'lg:grid-cols-[3rem_1fr]' : 'lg:grid-cols-[minmax(22rem,32rem)_1fr]'
		)}
	>
		{#if collapsed}
			<!--
			A rail, not a hidden panel. Collapsing the agent column should buy the
			workbook width without losing the thread — so the rail keeps the three
			things you would otherwise reopen the panel to check: whether it is
			working, how far through the plan it is, and what it last did.
		-->
			<section
				class="hidden min-h-0 w-12 flex-col items-center gap-2 border-r py-2 lg:flex"
				aria-label="Agent activity, collapsed"
			>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => (collapsed = false)}
					aria-label="Show the agent panel"
					title="Show the agent panel"
				>
					<HugeiconsIcon icon={SidebarLeft01Icon} size={16} />
				</Button>

				<span class="h-px w-6 bg-border" aria-hidden="true"></span>

				<!-- Working / idle -->
				<span
					class="flex size-8 items-center justify-center"
					title={run.busy ? 'Rowbot is working' : 'Idle'}
				>
					{#if run.busy}
						<HugeiconsIcon icon={Loading03Icon} size={15} class="animate-spin text-primary" />
					{:else if run.error}
						<HugeiconsIcon icon={Alert01Icon} size={15} class="text-destructive" />
					{:else}
						<span class="size-1.5 rounded-full bg-muted-foreground/40"></span>
					{/if}
				</span>

				<!-- Plan progress -->
				{#if planTotal > 0}
					<div
						class="flex flex-col items-center gap-1"
						title={`${planDone} of ${planTotal} plan steps done`}
					>
						<span class="text-[10px] font-medium text-muted-foreground tabular-nums">
							{planDone}/{planTotal}
						</span>
						<span class="h-10 w-1 overflow-hidden rounded-full bg-muted">
							<span
								class="block w-full rounded-full bg-primary transition-[height] duration-500"
								style:height="{(planDone / planTotal) * 100}%"
							></span>
						</span>
					</div>
				{/if}

				<!-- Last thing it did -->
				{#if lastTool}
					<span
						class="flex size-8 items-center justify-center text-muted-foreground/70"
						title={`Last step: ${lastTool.name}`}
					>
						<HugeiconsIcon icon={toolMeta(lastTool.name).icon} size={15} />
					</span>
				{/if}

				<div class="mt-auto flex flex-col items-center gap-2">
					{#if totalTokens > 0}
						<span
							class="text-[10px] text-muted-foreground/60 tabular-nums [writing-mode:vertical-rl]"
							title="Tokens used on this run"
						>
							{compactNumber(totalTokens)}
						</span>
					{/if}
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={run.busy || !run.workbook?.sheets.length}
						onclick={() =>
							send('Re-check every sheet against the source pages and fix anything wrong.')}
						aria-label="Re-check this workbook"
						title="Re-check this workbook"
					>
						<HugeiconsIcon icon={RefreshIcon} size={15} />
					</Button>
				</div>
			</section>
		{/if}

		<!-- Harness -->
		<!-- The chips inside are real buttons, so keyboard activation already works;
	     this listener only catches their click as it bubbles. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<section
			class={cn(
				'min-h-0 flex-col border-r lg:flex',
				collapsed && 'lg:hidden',
				pane === 'chat' ? 'flex' : 'hidden'
			)}
			aria-label="Agent activity"
			onclick={onFeedClick}
		>
			<div class="hidden h-9 shrink-0 items-center justify-end px-2 lg:flex">
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => (collapsed = true)}
					aria-label="Collapse the agent panel"
					title="Collapse the agent panel"
				>
					<HugeiconsIcon icon={SidebarLeft01Icon} size={16} />
				</Button>
			</div>

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

			{#if run.error}
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
							<p class="text-destructive">{run.error}</p>
							{#if run.outOfAllowance}
								<Button href={resolve('/settings')} variant="outline" size="sm">
									Add your API keys
								</Button>
							{/if}
						</div>
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
				{reveal}
				onattach={attach}
			/>
		</section>
	</div>
</div>
