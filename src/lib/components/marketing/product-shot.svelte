<script lang="ts">
	/**
	 * The landing page's product shot — built, not photographed.
	 *
	 * A screenshot would be a binary in the repo that goes stale the first time
	 * the grid changes, renders at one density, and is invisible to a screen
	 * reader. This is the same markup vocabulary as the real workspace on the
	 * same tokens, so it follows the theme, stays sharp at any zoom, and can
	 * simply be read.
	 *
	 * The content is real output from the fixture that ships with the tests: a
	 * quarterly table whose printed Q3 total does not reconcile. Showing the one
	 * case Rowbot exists for is worth more than showing four clean rows.
	 */
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Alert01Icon,
		CheckmarkCircle02Icon,
		DashboardSquare01Icon,
		File01Icon,
		FileSpreadsheetIcon,
		Message01Icon,
		Moon02Icon,
		Settings01Icon,
		TaskDaily01Icon
	} from '@hugeicons/core-free-icons';
	import Logo from '$lib/components/brand/logo.svelte';

	/** The rail, in the order the real one has them. */
	const RAIL = [
		{ icon: Message01Icon, label: 'Conversation', active: true },
		{ icon: DashboardSquare01Icon, label: 'Projects', active: false }
	];

	const plan = [
		'OCR the page and find its tables',
		'Import each into a named sheet',
		'Check every total'
	];

	const columns = ['Region', 'Q1', 'Q2', 'Q3', 'Q4'];
	const rows = [
		['North America', '12,430', '13,905', '8,200', '16,880'],
		['EMEA', '8,120', '8,640', '6,300', '10,050'],
		['APAC', '5,600', '6,215', '4,400', '7,995'],
		['LATAM', '2,310', '2,480', '2,200', '2,910']
	];
	const totals = ['Total', '28,460', '31,240', '20,100', '37,835'];
	/**
	 * Q3 is column D, and with a header row plus four regions the total lands on
	 * row 6 — so the flagged cell is D6 and the range under it is D2:D5. The
	 * whole point of the shot is a tool that checks arithmetic; the arithmetic
	 * in the shot has to survive being checked.
	 */
	const FLAGGED = 3;
</script>

<div
	class="overflow-hidden rounded-2xl border bg-rail shadow-2xl shadow-black/10 dark:shadow-black/40"
>
	<!--
		No title bar and no three dots. The app does not have a bar across the
		top — that is rather the point of it — and a shot that invents one is
		advertising an interface nobody will find when they arrive.
	-->
	<div class="grid md:grid-cols-[2.25rem_16rem_1fr]">
		<!-- The rail: all the chrome there is. -->
		<div class="hidden flex-col items-center gap-2 border-r py-2.5 md:flex" aria-hidden="true">
			<Logo class="mb-0.5 size-4" />
			{#each RAIL as item (item.label)}
				<HugeiconsIcon
					icon={item.icon}
					size={13}
					class={item.active ? 'text-accent-ink' : 'text-muted-foreground/60'}
				/>
			{/each}
			<span class="flex-1"></span>
			<HugeiconsIcon icon={Moon02Icon} size={13} class="text-muted-foreground/60" />
			<HugeiconsIcon icon={Settings01Icon} size={13} class="text-muted-foreground/60" />
			<span class="mt-0.5 size-4 rounded-full bg-foreground/10"></span>
		</div>

		<!-- The conversation. Below `md` the sheet is the whole story. -->
		<div class="hidden flex-col gap-2.5 border-r p-3 md:flex">
			<div class="rounded-xl border bg-card p-2.5">
				<div class="mb-2 flex items-center gap-2">
					<span class="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
						Plan
					</span>
					<span class="h-1 flex-1 overflow-hidden rounded-full bg-muted">
						<span class="block h-full w-full rounded-full bg-accent-ink"></span>
					</span>
					<span class="text-[10px] text-muted-foreground tabular-nums">3/3</span>
				</div>
				<ul class="space-y-1.5">
					{#each plan as step (step)}
						<li class="flex gap-1.5 text-[11px] leading-snug text-muted-foreground line-through">
							<HugeiconsIcon
								icon={CheckmarkCircle02Icon}
								size={11}
								class="mt-0.5 shrink-0 text-accent-ink"
							/>
							{step}
						</li>
					{/each}
				</ul>
			</div>

			<p class="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
				<HugeiconsIcon icon={TaskDaily01Icon} size={12} class="shrink-0" />
				check_totals · Revenue by Region
			</p>

			<div class="flex gap-2">
				<span
					class="mt-px flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
				>
					<Logo class="size-3" />
				</span>
				<p class="text-[11px] leading-relaxed text-foreground/90">
					Three of the four quarterly totals reconcile. <span
						class="rounded bg-accent-ink/10 px-1 font-mono text-[10px] text-accent-ink"
					>
						Revenue!D6
					</span>
					prints 20,100 where the column adds up to 21,100 — I kept the page's figure and flagged it.
				</p>
			</div>
		</div>

		<!-- The sheet. -->
		<div class="p-3">
			<div class="flex items-center gap-1.5 pb-2.5">
				<span
					class="flex items-center gap-1.5 rounded-md bg-card px-2 py-1 text-[11px] font-medium shadow-sm"
				>
					<HugeiconsIcon icon={FileSpreadsheetIcon} size={11} />
					Workbook
				</span>
				<span
					class="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-muted-foreground"
				>
					<HugeiconsIcon icon={File01Icon} size={11} />
					Source
				</span>
			</div>

			<div class="overflow-hidden rounded-xl border bg-background shadow-sm">
				<table class="w-full border-collapse text-[11px] tabular-nums">
					<thead>
						<tr>
							<th
								class="w-7 border-r border-b border-[var(--grid-line)] bg-[var(--grid-header-bg)] py-1"
							>
								<span class="sr-only">Row</span>
							</th>
							{#each columns as column, i (column)}
								<th
									class="border-b border-[var(--grid-line)] bg-[var(--grid-header-bg)] px-2 py-1 font-medium {i ===
									0
										? 'text-left'
										: 'text-right'}"
								>
									{column}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each rows as row, r (row[0])}
							<tr>
								<th
									class="border-r border-b border-[var(--grid-line)] bg-[var(--grid-header-bg)] px-1 text-right font-normal text-muted-foreground"
								>
									{r + 2}
								</th>
								{#each row as cell, c (c)}
									<td
										class="border-b border-[var(--grid-line-vertical)] px-2 py-1 {c === 0
											? 'text-left'
											: 'text-right'}"
									>
										{cell}
									</td>
								{/each}
							</tr>
						{/each}
						<tr>
							<th
								class="border-r border-[var(--grid-line)] bg-[var(--grid-header-bg)] px-1 text-right font-normal text-muted-foreground"
							>
								6
							</th>
							{#each totals as cell, c (c)}
								<td
									class="px-2 py-1 font-medium {c === 0 ? 'text-left' : 'text-right'} {c === FLAGGED
										? 'bg-amber-500/15 ring-1 ring-amber-500/50 ring-inset'
										: ''}"
								>
									{cell}
								</td>
							{/each}
						</tr>
					</tbody>
				</table>

				<p
					class="flex items-start gap-1.5 border-t bg-muted/25 px-2.5 py-2 text-[11px] text-muted-foreground"
				>
					<HugeiconsIcon icon={Alert01Icon} size={12} class="mt-0.5 shrink-0 text-amber-500" />
					<span>
						<span class="font-mono text-foreground">D6</span> — the page printed 20,100, but D2:D5
						adds up to
						<span class="text-foreground">21,100</span>.
					</span>
				</p>
			</div>
		</div>
	</div>
</div>
