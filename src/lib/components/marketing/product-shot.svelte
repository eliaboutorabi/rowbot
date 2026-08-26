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
	import Icon from '$lib/components/ui/icon.svelte';
	import {
		Alert01Icon,
		ArrowUp01Icon,
		BorderBottom01Icon,
		CheckmarkCircle02Icon,
		ClockIcon,
		DashboardSquare01Icon,
		Download04Icon,
		File01Icon,
		FileSpreadsheetIcon,
		Message01Icon,
		PlusSignIcon,
		QuestionIcon,
		Moon02Icon,
		Settings01Icon,
		SourceCodeIcon,
		ThermometerIcon,
		ViewIcon
	} from '@hugeicons/core-free-icons';
	import Logo from '$lib/components/brand/logo.svelte';
	import { confidenceColor } from '$lib/confidence';
	import { tokenClass, tokenize } from '$lib/highlight';

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
		['LATAM', '2,310', '2,480', '2,200', '2,910'],
		['UK & Ireland', '4,870', '5,120', '3,650', '6,240']
	];
	const totals = ['Total', '33,330', '36,360', '23,750', '44,075'];

	/** Row the total lands on: a header plus one per region. */
	const TOTAL_ROW = rows.length + 2;
	/** The flagged cell and the range under it, as the copy has to name them. */
	const FLAGGED_CELL = `D${TOTAL_ROW}`;
	const FLAGGED_RANGE = `D2:D${TOTAL_ROW - 1}`;
	/**
	 * Q3 is column D, so the flagged cell is D7 and the range under it D2:D6.
	 * The whole point of the shot is a tool that checks arithmetic, so the
	 * arithmetic in the shot has to survive being checked: every column here
	 * adds up, and Q3 is out by exactly the thousand the caption claims —
	 * 24,750 against a printed 23,750.
	 *
	 * Five regions, not eight. Three more rows said nothing the five do not,
	 * and cost the shot its last inch of the first screen; a visitor scrolling
	 * to find the bottom of a picture is a visitor who has stopped reading.
	 */
	const FLAGGED = 3;
	const PRINTED = '23,750';
	const COMPUTED = '24,750';

	/** The least confident cell on the sheet, which colours the readout. */
	const WORST = 0.912;

	/**
	 * Real shape: the same helpers the sandbox actually exposes, and short
	 * enough to fit the conversation column without a clipped line — a snippet
	 * cut off mid-expression reads as a rendering fault, not as code.
	 */
	const SNIPPET = `const d = sheets['Revenue'].col('D');
log(round(d.reduce((a, b) => a + b)));`;

	/**
	 * The page itself, for the docked half — the same figures as the sheet
	 * above it, because the claim being made is that one came out of the other.
	 * Region and Q1-Q4 only: the shot's page is a thumbnail's worth of paper and
	 * a fifth column would be unreadable at this size.
	 */
	const PAGE_ROWS = rows.map((row) => row.slice(0, 5));

	/** What the reader found on the page, as the toolbar counts it. */
	const LEGEND = [
		{ label: 'table', token: '--seg-table', count: 2 },
		{ label: 'title', token: '--seg-title', count: 1 },
		{ label: 'text', token: '--seg-ink', count: 3 },
		{ label: 'caption', token: '--seg-figure', count: 1 }
	];

	const SHEETS = [
		{ name: 'Revenue by Region', rows: 5 },
		{ name: 'Details', rows: 9 }
	];
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
				<Icon
					icon={item.icon}
					size={13}
					class={item.active ? 'text-accent-ink' : 'text-muted-foreground/60'}
				/>
			{/each}
			<span class="flex-1"></span>
			<Icon icon={Moon02Icon} size={13} class="text-muted-foreground/60" />
			<Icon icon={Settings01Icon} size={13} class="text-muted-foreground/60" />
			<span class="mt-0.5 size-4 rounded-full bg-foreground/10"></span>
		</div>

		<!-- The conversation. Below `md` the sheet is the whole story. -->
		<div class="hidden flex-col gap-2.5 border-r p-2.5 md:flex">
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
						<!-- Not struck through, because the app does not strike them
						     through. A shot of the product has to be a shot of the
						     product. -->
						<li class="flex gap-1.5 text-[11px] leading-snug text-muted-foreground">
							<Icon
								icon={CheckmarkCircle02Icon}
								size={11}
								class="mt-0.5 shrink-0 text-accent-ink"
							/>
							{step}
						</li>
					{/each}
				</ul>
			</div>

			<!--
				The code, coloured by the same tokeniser the app uses. Writing and
				running the arithmetic is the thing that separates this from every
				other converter, and a page that only claims it is asking to be
				believed. Four lines is enough to show what kind of thing it is.
			-->
			<div class="rounded-xl border bg-card p-2.5">
				<p class="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
					<Icon icon={SourceCodeIcon} size={12} class="shrink-0" />
					Worked it out · checked four column totals
				</p>
				<pre
					class="overflow-hidden rounded-md bg-muted/40 p-1.5 font-mono text-[9.5px] leading-[1.45]"><code
						>{#each tokenize(SNIPPET) as token, i (i)}<span class={tokenClass(token.kind)}
								>{token.text}</span
							>{/each}</code
					></pre>
			</div>

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
						Revenue!{FLAGGED_CELL}
					</span>
					prints {PRINTED} where the column adds up to {COMPUTED} — I kept the page's figure and flagged
					it.
				</p>
			</div>

			<!--
				What to ask next, which is what the real column offers once a turn
				has finished and is written for the workbook in front of it rather
				than picked from a list. It also fills the gap the docked page opened
				up between the last message and the composer, which is the honest
				reason it is here rather than at the top of this comment.
			-->
			<div class="mt-auto flex flex-wrap gap-1 pt-2">
				{#each ['Check the Q3 column', 'Pull out the details'] as chip, i (chip)}
					<span
						class="flex items-center gap-1 rounded-full border border-border/70 bg-card/60 px-1.5 py-0.5 text-[9px] text-muted-foreground"
					>
						<Icon icon={i === 0 ? ThermometerIcon : QuestionIcon} size={9} />
						{chip}
					</span>
				{/each}
			</div>

			<!--
				The composer. Without it the column is a transcript of something that
				already happened, and the one thing a visitor most needs to
				understand — that they can answer back, and that this carries on
				being a conversation — is nowhere on the page.
			-->
			<div class="mt-1.5 rounded-xl border bg-card">
				<p class="px-2.5 pt-2 text-[11px] text-muted-foreground">Ask Rowbot for a change…</p>
				<div class="flex items-center gap-1.5 px-2 pt-1.5 pb-2">
					<span
						class="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
					>
						Terra
						<span class="opacity-60">· Medium</span>
					</span>
					<span class="flex-1"></span>
					<span
						class="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
					>
						<Icon icon={ArrowUp01Icon} size={11} />
					</span>
				</div>
			</div>
		</div>

		<!-- The sheet. -->
		<div class="p-2.5">
			<!--
				The whole toolbar, not half of it. The shot used to stop after the two
				view tabs, so the page advertised an app with no confidence readout,
				no history and no way to get the file out — three of the things
				somebody deciding whether to sign up most wants to see.
			-->
			<div class="flex items-center gap-1.5 pb-2.5">
				<!--
					Split is the selected view here, so it is the split control that
					carries the raised card and the two tabs that go quiet — which is
					how the real switcher behaves, and it is worth being exact about,
					because the state being shown is the one the shot is about.
				-->
				<span
					class="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-muted-foreground"
				>
					<Icon icon={FileSpreadsheetIcon} size={11} />
					Workbook
				</span>
				<span
					class="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-muted-foreground"
				>
					<Icon icon={File01Icon} size={11} />
					Source
				</span>
				<span class="rounded-md bg-card px-1.5 py-1 shadow-sm">
					<Icon icon={BorderBottom01Icon} size={11} />
				</span>

				<span class="hidden min-w-0 truncate pl-1 text-[11px] font-medium lg:block">
					Meridian Group — FY2025
				</span>

				<span class="flex-1"></span>

				<Icon icon={ClockIcon} size={11} class="text-muted-foreground/70" />
				<!-- Coloured off the same ramp the app uses, at the worst cell in
				     this sheet — which is the point being made. -->
				<span class="flex items-center gap-1" style={`color:${confidenceColor(WORST)}`}>
					<Icon icon={ThermometerIcon} size={11} />
					<span class="text-[10px] font-medium tabular-nums">
						{(WORST * 100).toFixed(1)}%
					</span>
				</span>
				<span
					class="flex items-center gap-1 rounded-md bg-primary px-1.5 py-1 text-[10px] font-medium text-primary-foreground"
				>
					<Icon icon={Download04Icon} size={10} />
					.xlsx
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
							<!-- Left, all of it, as the app's grid now is. The paper docked
							     below still right-aligns its figures, because printed reports
							     do — and that difference between the page and the sheet is
							     real, so the shot should show it. -->
							{#each columns as column (column)}
								<th
									class="border-b border-[var(--grid-line)] bg-[var(--grid-header-bg)] px-2 py-1 text-left font-medium"
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
									<td class="border-b border-[var(--grid-line-vertical)] px-2 py-1 text-left">
										{cell}
									</td>
								{/each}
							</tr>
						{/each}
						<tr>
							<th
								class="border-r border-[var(--grid-line)] bg-[var(--grid-header-bg)] px-1 text-right font-normal text-muted-foreground"
							>
								{TOTAL_ROW}
							</th>
							{#each totals as cell, c (c)}
								<td
									class="px-2 py-1 text-left font-medium {c === FLAGGED
										? 'bg-amber-500/15 ring-2 ring-accent-ink ring-inset'
										: ''}"
								>
									{cell}
								</td>
							{/each}
						</tr>
					</tbody>
				</table>

				<!--
					The cell inspector, which is what the real app puts under the grid
					the moment anything is selected — and the place "shows you where on
					the page each figure came from" actually happens. A shot that
					omitted it was omitting the control the headline is about.
				-->
				<div
					class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t bg-muted/25 px-2.5 py-1.5 text-[10px]"
				>
					<span class="font-mono text-[11px] font-semibold tabular-nums">{FLAGGED_CELL}</span>
					<!-- `flex-1` on the value, which is how the real inspector does it:
					     it is what holds the two actions and the confidence against the
					     right edge rather than letting them trail off after the type. -->
					<span class="min-w-0 flex-1 truncate text-[11px] text-foreground tabular-nums">
						{PRINTED}
					</span>
					<span class="text-muted-foreground">Q3</span>
					<span class="text-muted-foreground">Number</span>
					<span class="flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 text-accent-ink">
						<Icon icon={PlusSignIcon} size={10} />
						Add to chat
					</span>
					<span class="flex items-center gap-0.5 text-accent-ink">
						<Icon icon={ViewIcon} size={11} />
						Show on page 1
					</span>
					<span class="tabular-nums" style={`color:${confidenceColor(WORST)}`}>
						{(WORST * 100).toFixed(1)}% · slightly unsure
					</span>
				</div>

				<p
					class="flex items-start gap-1.5 border-t bg-destructive/8 px-2.5 py-2 text-[11px] text-destructive"
				>
					<Icon icon={Alert01Icon} size={12} class="mt-0.5 shrink-0" />
					<span>
						The page printed <span class="font-medium">{PRINTED}</span>, but {FLAGGED_RANGE} adds up to
						<span class="font-medium">{COMPUTED}</span>. Kept the page's figure and flagged it.
					</span>
				</p>
			</div>

			<!-- Sheet tabs, where a spreadsheet puts them. A workbook with one
			     unnamed grid and no tabs is a table; the tabs are what say this
			     came out as a file somebody can open in Excel. -->
			<div class="flex items-center gap-1 pt-2">
				{#each SHEETS as sheet, i (sheet.name)}
					<span
						class="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium {i === 0
							? 'bg-secondary text-foreground'
							: 'text-muted-foreground'}"
					>
						{sheet.name}
						<span class="text-[9px] text-muted-foreground tabular-nums">{sheet.rows}</span>
					</span>
				{/each}
			</div>

			<!-- ── The page, docked under the sheet it became ────────────────
			     The claim on this page is that every figure is traceable to the
			     paper, and a shot of the workbook alone asks to be taken on
			     trust. So: the split view, with the reader's own segmentation
			     drawn over the page — every block boxed and typed, the table
			     among them, in the same colours the app uses. The figures below
			     are the figures above, which is the point.

			     The handle is real too: that line is the one you drag to give
			     the page more or less of the pane. -->
			<div class="mt-2.5 h-px bg-border"></div>

			<div class="flex items-center gap-2 py-1.5">
				<span class="shrink-0 text-[10px] text-muted-foreground tabular-nums">Page 1 of 7</span>
				<span class="hidden min-w-0 items-center gap-2 overflow-hidden sm:flex">
					{#each LEGEND as item (item.label)}
						<span
							class="flex shrink-0 items-center gap-1 text-[9px] whitespace-nowrap text-muted-foreground"
						>
							<!-- A white backing, as in the app: these are miniatures of
							     boxes drawn on paper, and the tones are mixed for paper. -->
							<span class="size-2 shrink-0 rounded-[2px] bg-white">
								<span
									class="block size-full rounded-[2px] border"
									style={`border-color: var(${item.token})`}
								></span>
							</span>
							{item.label}
							<span class="tabular-nums">{item.count}</span>
						</span>
					{/each}
				</span>
				<span class="flex-1"></span>
				<span class="flex shrink-0 items-center gap-1 text-[10px] font-medium text-accent-ink">
					<Icon icon={ViewIcon} size={11} />
					Segmentation
				</span>
			</div>

			<div class="flex gap-2 rounded-xl border bg-muted/30 p-2">
				<!-- The thumbnail rail. Two pages of seven, the first one current. -->
				<div class="hidden w-8 shrink-0 flex-col gap-1.5 lg:flex" aria-hidden="true">
					{#each [0, 1] as page (page)}
						<span
							class="block space-y-[3px] rounded-[3px] bg-white px-[3px] py-[4px] {page === 0
								? 'ring-2 ring-primary'
								: 'ring-1 ring-black/10'}"
						>
							<!-- Keyed by index: two lines of the same length is a duplicate
							     key, and Svelte throws on that rather than rendering. -->
							{#each [100, 80, 100, 90, 60] as width, line (line)}
								<span class="block h-px bg-neutral-300" style={`width:${width}%`}></span>
							{/each}
						</span>
					{/each}
				</div>

				<!-- The page. White whichever theme the app is wearing, because it
				     is paper: the real one is a PDF rendered to a canvas.

				     Clipped at the foot, because a docked page is: the dock is a
				     fixed height you drag, and the page runs on underneath it. A
				     shot that shrank the whole page to fit the dock would be showing
				     an app that does not exist. -->
				<div
					class="max-h-[8.25rem] min-w-0 flex-1 space-y-1 overflow-hidden rounded-md bg-white px-2.5 py-2 ring-1 ring-black/10"
				>
					<div
						class="rounded-[2px] border border-[var(--seg-title)]/75 bg-[var(--seg-title)]/10 px-1"
					>
						<p class="text-[10px] font-semibold text-neutral-900">
							Meridian Group — Global Sales Ledger
						</p>
					</div>
					<div
						class="rounded-[2px] border border-[var(--seg-ink)]/40 bg-[var(--seg-ink)]/[0.06] px-1"
					>
						<p class="text-[8px] text-neutral-700">
							Fiscal year 2025. All revenue in USD, thousands.
						</p>
					</div>
					<div
						class="rounded-[2px] border border-[var(--seg-figure)]/75 bg-[var(--seg-figure)]/10 px-1"
					>
						<p class="text-[8px] font-medium text-neutral-800">Table 1. Revenue by Region</p>
					</div>
					<div
						class="rounded-[2px] border border-[var(--seg-table)]/75 bg-[var(--seg-table)]/10 p-1"
					>
						<table class="w-full border-collapse text-[8px] text-neutral-800 tabular-nums">
							<thead>
								<tr class="border-b border-neutral-400">
									{#each ['Region', 'Q1', 'Q2', 'Q3', 'Q4'] as column, i (column)}
										<th class="py-px font-semibold {i === 0 ? 'text-left' : 'text-right'}">
											{column}
										</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each PAGE_ROWS as row (row[0])}
									<tr>
										{#each row as cell, c (c)}
											<td class="py-px {c === 0 ? 'text-left' : 'text-right'}">{cell}</td>
										{/each}
									</tr>
								{/each}
								<tr class="border-t border-neutral-400 font-semibold">
									{#each totals as cell, c (c)}
										<td class="py-px {c === 0 ? 'text-left' : 'text-right'}">{cell}</td>
									{/each}
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
