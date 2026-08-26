<script lang="ts">
	import { resolve } from '$app/paths';
	import Wordmark from '$lib/components/brand/wordmark.svelte';

	let { children } = $props();
</script>

<div class="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
	<!--
		Brand panel: hidden on small screens where it would just push the form
		down. The divider is a gradient rather than a rule — a hard line down the
		middle of a page this quiet is the loudest thing on it, and the two halves
		should read as one surface lit from the left.
	-->
	<aside
		class="relative hidden overflow-hidden bg-sidebar p-12 lg:flex lg:flex-col lg:justify-between"
	>
		<div
			class="pointer-events-none absolute -top-40 -left-32 size-[34rem] rounded-full bg-primary/12 blur-3xl dark:bg-primary/20"
		></div>
		<div
			class="pointer-events-none absolute -right-40 -bottom-48 size-[30rem] rounded-full bg-chart-2/10 blur-3xl"
		></div>
		<div
			class="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-border to-transparent"
		></div>

		<a href={resolve('/')} class="relative w-fit"><Wordmark size="md" /></a>

		<div class="relative max-w-md space-y-6">
			<h1 class="text-4xl leading-[1.12] font-semibold tracking-tight text-balance">
				Every number,
				<span class="text-accent-ink">traceable back to the page it came from.</span>
			</h1>
			<p class="text-lg leading-relaxed text-pretty text-muted-foreground">
				Rowbot reads your PDFs and scans, checks the arithmetic by running it, and hands you a
				workbook where every figure points back at the paper.
			</p>
		</div>

		<!--
			Three claims, each one checkable. The rule above them separates the
			proof from the pitch without another box.
		-->
		<dl class="relative grid grid-cols-3 gap-6 border-t pt-6 text-sm">
			{#each [{ term: 'Reads', detail: 'PDFs, photos, bad scans' }, { term: 'Checks', detail: 'Arithmetic, by running it' }, { term: 'Keeps', detail: 'A link to the page' }] as fact (fact.term)}
				<div>
					<dt class="text-xs tracking-wide text-muted-foreground uppercase">{fact.term}</dt>
					<dd class="mt-1.5 leading-snug font-medium text-pretty">{fact.detail}</dd>
				</div>
			{/each}
		</dl>
	</aside>

	<main class="flex items-center justify-center px-6 py-12">
		<div class="w-full max-w-sm">
			<a href={resolve('/')} class="mb-10 flex justify-center lg:hidden"><Wordmark size="md" /></a>
			{@render children()}
		</div>
	</main>
</div>
