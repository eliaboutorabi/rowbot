<script lang="ts">
	import { resolve } from '$app/paths';
	import Wordmark from '$lib/components/brand/wordmark.svelte';

	let { children } = $props();
</script>

<div class="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
	<!-- Brand panel: hidden on small screens where it would just push the form down. -->
	<aside
		class="relative hidden overflow-hidden border-r bg-sidebar p-12 lg:flex lg:flex-col lg:justify-between"
	>
		<div
			class="pointer-events-none absolute -top-40 -left-32 size-[34rem] rounded-full bg-primary/12 blur-3xl"
		></div>
		<div
			class="pointer-events-none absolute -right-40 -bottom-48 size-[30rem] rounded-full bg-chart-2/10 blur-3xl"
		></div>

		<a href={resolve('/')} class="relative w-fit"><Wordmark size="md" /></a>

		<div class="relative max-w-md space-y-6">
			<h1 class="text-4xl leading-[1.12] font-semibold tracking-tight text-balance">
				Every number, traceable back to the page it came from.
			</h1>
			<p class="text-lg leading-relaxed text-pretty text-muted-foreground">
				Rowbot reads your PDFs and scans, builds the workbook, then shows you its working — so you
				can check it before you trust it.
			</p>
		</div>

		<dl class="relative grid grid-cols-3 gap-6 text-sm">
			<div>
				<dt class="text-muted-foreground">Reads</dt>
				<dd class="mt-1 font-medium">PDFs &amp; images</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Writes</dt>
				<dd class="mt-1 font-medium">Real .xlsx</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Keeps</dt>
				<dd class="mt-1 font-medium">Source provenance</dd>
			</div>
		</dl>
	</aside>

	<main class="flex items-center justify-center px-6 py-12">
		<div class="w-full max-w-sm">
			<a href={resolve('/')} class="mb-10 flex justify-center lg:hidden"><Wordmark size="md" /></a>
			{@render children()}
		</div>
	</main>
</div>
