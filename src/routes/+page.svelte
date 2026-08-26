<script lang="ts">
	import Icon from '$lib/components/ui/icon.svelte';
	import {
		ArrowRightBigIcon,
		FileSearchIcon,
		GithubIcon,
		Moon02Icon,
		ScanImageIcon,
		SourceCodeIcon,
		Sun03Icon
	} from '@hugeicons/core-free-icons';
	import ProductShot from '$lib/components/marketing/product-shot.svelte';
	import Wordmark from '$lib/components/brand/wordmark.svelte';
	import { Button } from '$lib/components/ui/button';
	import { theme } from '$lib/theme.svelte';
	import type { LayoutData } from './$types';

	let { data }: { data: LayoutData } = $props();

	/**
	 * Three things, each one something the app actually does and most of the
	 * alternatives do not. Written against the build rather than the ambition:
	 * the confidence is per cell, the arithmetic really is executed, and the
	 * provenance really does land on the figure.
	 */
	const steps = [
		{
			icon: ScanImageIcon,
			title: 'Made for bad scans',
			body: 'A photograph, a fax, a page that has been through the copier twice. Merged headers and spans survive, right-to-left tables stay the right way round, and every cell carries how sure the reader was.'
		},
		{
			icon: SourceCodeIcon,
			title: 'Checks the sums by running them',
			body: 'It writes the arithmetic as code and executes it, so a total that does not reconcile is caught by a computer rather than guessed at — and you can read the code it ran.'
		},
		{
			icon: FileSearchIcon,
			title: 'Every figure traceable',
			body: 'Click a number and the page it came from opens beneath the sheet with that figure marked. Nothing in the workbook is further than one click from the paper.'
		}
	];
</script>

<svelte:head>
	<title>Rowbot · Agentic OCR that checks its own arithmetic</title>
</svelte:head>

<div class="relative min-h-dvh overflow-x-clip bg-background">
	<!--
		One glow, behind the header as well as the hero.

		It used to live inside the hero section, which is `overflow-hidden` — so
		it was clipped flat along the section's top edge and the result was a
		band of shading that started exactly where the header ended. The header
		looked like a separate, slightly darker strip pasted on. Out here it
		reaches the top of the page and the colour simply arrives, with nothing
		to draw a line under.
	-->
	<div class="pointer-events-none absolute inset-x-0 top-0 h-[46rem]" aria-hidden="true">
		<div
			class="absolute top-[-24rem] left-1/2 size-[58rem] -translate-x-1/2 rounded-full bg-primary/12 blur-3xl dark:bg-primary/20"
		></div>
		<div
			class="absolute top-[-14rem] left-[22%] size-[30rem] -translate-x-1/2 rounded-full bg-chart-2/8 blur-3xl dark:bg-chart-2/12"
		></div>
		<div
			class="absolute top-[-18rem] left-[80%] size-[26rem] -translate-x-1/2 rounded-full bg-chart-1/8 blur-3xl dark:bg-chart-1/10"
		></div>
	</div>

	<header class="relative mx-auto flex h-14 max-w-6xl items-center gap-4 px-6">
		<Wordmark size="md" />
		<div class="ml-auto flex items-center gap-2">
			<Button
				variant="ghost"
				size="icon"
				href="https://github.com/eliaboutorabi/rowbot"
				target="_blank"
				rel="noreferrer"
				aria-label="Rowbot on GitHub"
			>
				<Icon icon={GithubIcon} size={18} />
			</Button>
			<Button variant="ghost" size="icon" onclick={() => theme.toggle()} aria-label="Toggle theme">
				<Icon icon={theme.current === 'dark' ? Sun03Icon : Moon02Icon} size={18} />
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
		<!--
			Deliberately tight. The hero and the product shot together are what a
			visitor should see without scrolling, and on a 900px window the old
			spacing pushed the foot of the shot just past the fold.
		-->
		<section class="relative px-6 pt-10 pb-12">
			<div class="mx-auto max-w-3xl text-center">
				<h1 class="text-5xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
					Agentic OCR that
					<span class="text-accent-ink">checks its own arithmetic</span>
				</h1>

				<!--
					The sub-line no longer repeats the headline. The headline has taken
					the checking, so this one carries what is left: what you can put in,
					what comes out, and the provenance.
				-->
				<p class="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted-foreground">
					Drop in a PDF or a photograph — a bad scan is fine. Rowbot builds the Excel workbook,
					flags any total that does not reconcile, and shows you where on the page every figure came
					from.
				</p>

				<div class="mt-9 flex flex-wrap items-center justify-center gap-3">
					<Button size="lg" href={data.user ? '/documents' : '/sign-up'} class="gap-2">
						{data.user ? 'Open Rowbot' : 'Start converting'}
						<Icon icon={ArrowRightBigIcon} size={17} />
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
		<section class="relative mx-auto max-w-5xl px-6 pb-24">
			<ProductShot />
		</section>

		<section class="mx-auto max-w-5xl px-6 pb-24">
			<ul class="grid gap-4 md:grid-cols-3">
				{#each steps as step (step.title)}
					<li class="rounded-2xl border bg-card p-6">
						<span
							class="mb-4 flex size-10 items-center justify-center rounded-xl border bg-background text-accent-ink"
						>
							<Icon icon={step.icon} size={19} />
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
			<a
				href="https://github.com/eliaboutorabi/rowbot"
				target="_blank"
				rel="noreferrer"
				class="flex items-center gap-1.5 transition-colors hover:text-foreground"
			>
				<Icon icon={GithubIcon} size={15} />
				Source
			</a>
			<span class="ml-auto">
				Designed and developed by
				<a
					href="https://www.linkedin.com/in/elham-aboutorabi/"
					target="_blank"
					rel="noreferrer"
					class="font-medium text-foreground underline-offset-4 hover:underline"
				>
					Eli Aboutorabi
				</a>
				with the help of Claude.
			</span>
		</div>
	</footer>
</div>
