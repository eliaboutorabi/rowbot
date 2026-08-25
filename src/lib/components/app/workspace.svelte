<script lang="ts">
	import { resolve } from '$app/paths';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Alert01Icon, Key01Icon, PlayIcon, RefreshIcon } from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import Activity from '$lib/components/agent/activity.svelte';
	import Composer from '$lib/components/agent/composer.svelte';
	import WorkbookView from '$lib/components/grid/workbook-view.svelte';
	import Logo from '$lib/components/brand/logo.svelte';
	import { RunState, type TimelineItem } from '$lib/stores/run.svelte';
	import { fileSize } from '$lib/format';
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
</script>

<svelte:head><title>{data.document.name} · Rowbot</title></svelte:head>

<div class="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(22rem,32rem)_1fr]">
	<!-- Harness -->
	<section class="flex min-h-0 flex-col border-r" aria-label="Agent activity">
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

		<Composer {run} bind:model bind:effort onsend={send} onresume={resume} />
	</section>

	<!-- Workbook -->
	<section class="min-h-0 min-w-0" aria-label="Workbook preview">
		<WorkbookView workbook={run.workbook} documentId={data.document.id} busy={run.busy} />
	</section>
</div>
