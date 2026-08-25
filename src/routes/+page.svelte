<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		AiBrain01Icon,
		ArrowRight02Icon,
		FileSearchIcon,
		Moon02Icon,
		Sun03Icon,
		Table01Icon
	} from '@hugeicons/core-free-icons';
	import ProductShot from '$lib/components/marketing/product-shot.svelte';
	import Wordmark from '$lib/components/brand/wordmark.svelte';
	import { Button } from '$lib/components/ui/button';
	import { theme } from '$lib/theme.svelte';
	import type { LayoutData } from './$types';

	let { data }: { data: LayoutData } = $props();

	const steps = [
		{
			icon: FileSearchIcon,
			title: 'Reads the page, not just the text',
			body: 'Mistral Document AI returns the table structure — merged headers, spans, per-block confidence — instead of a flat wall of characters.'
		},
		{
			icon: AiBrain01Icon,
			title: 'Shows its working',
			body: 'A planning agent decides how the workbook should be shaped, then checks itself. Every tool call, every correction, visible as it happens.'
		},
		{
			icon: Table01Icon,
			title: 'Hands you a real spreadsheet',
			body: 'Numbers that add up, percentages Excel understands, merged headers intact — and a note on every cell it was unsure about.'
		}
	];
</script>

<svelte:head>
	<title>Rowbot · Tables out of documents, with the working shown</title>
</svelte:head>

<div class="min-h-dvh bg-background">
	<header class="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
		<Wordmark size="md" />
		<div class="ml-auto flex items-center gap-2">
			<Button variant="ghost" size="icon" onclick={() => theme.toggle()} aria-label="Toggle theme">
				<HugeiconsIcon icon={theme.current === 'dark' ? Sun03Icon : Moon02Icon} size={18} />
			</Button>
			{#if data.user}
				<Button href="/documents">Open Rowbot</Button>
			{:else}
				<Button variant="ghost" href="/sign-in">Sign in</Button>
				<Button href="/sign-up">Get started</Button>
			{/if}
		</div>
	</header>

	<main>
		<section class="relative overflow-hidden px-6 pt-20 pb-24">
			<div
				class="pointer-events-none absolute top-[-16rem] left-1/2 size-[44rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
				aria-hidden="true"
			></div>

			<div class="relative mx-auto max-w-3xl text-center">
				<p
					class="mb-6 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground"
				>
					<span class="size-1.5 rounded-full bg-primary"></span>
					Mistral Document AI · GPT-5.6 · Deep Agents
				</p>

				<h1 class="text-5xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
					Tables out of documents,
					<span class="text-accent-ink">with the working shown</span>
				</h1>

				<p class="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
					Drop in a PDF or a photo of a table. Rowbot builds the Excel workbook — and lets you watch
					it plan, read, check and correct, so you know what to trust.
				</p>

				<div class="mt-9 flex flex-wrap items-center justify-center gap-3">
					<Button size="lg" href={data.user ? '/documents' : '/sign-up'} class="gap-2">
						{data.user ? 'Open Rowbot' : 'Start converting'}
						<HugeiconsIcon icon={ArrowRight02Icon} size={17} />
					</Button>
					{#if !data.user}
						<Button size="lg" variant="ghost" href="/sign-in">I already have an account</Button>
					{/if}
				</div>
			</div>
		</section>

		<!--
			The product, before the pitch. The copy claims Rowbot shows its
			working, and a page that says so without showing any is asking to be
			taken on faith.
		-->
		<section class="mx-auto -mt-8 max-w-5xl px-6 pb-24">
			<ProductShot />
		</section>

		<section class="mx-auto max-w-5xl px-6 pb-24">
			<ul class="grid gap-4 md:grid-cols-3">
				{#each steps as step (step.title)}
					<li class="rounded-2xl border bg-card p-6">
						<span
							class="mb-4 flex size-10 items-center justify-center rounded-xl border bg-background text-accent-ink"
						>
							<HugeiconsIcon icon={step.icon} size={19} />
						</span>
						<h2 class="mb-2 font-medium">{step.title}</h2>
						<p class="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
					</li>
				{/each}
			</ul>
		</section>
	</main>

	<footer class="border-t">
		<div
			class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-6 text-sm text-muted-foreground"
		>
			<Wordmark size="sm" class="opacity-70" />
			<span class="ml-auto">Built with SvelteKit, Deep Agents and Mistral Document AI.</span>
		</div>
	</footer>
</div>
