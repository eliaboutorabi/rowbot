<script lang="ts">
	/**
	 * What a phone gets.
	 *
	 * Rowbot puts a workbook, the page it was read from and the conversation
	 * that produced it beside each other, and the whole argument of the thing is
	 * that you can check one against the other without losing your place. There
	 * is no width on a phone where that holds, and shipping a cramped version of
	 * it would be shipping something that cannot make its own case.
	 *
	 * So this is not an error page — it is the landing page, for a reader who
	 * cannot use the product yet. It still says what Rowbot is, because that is
	 * the thing worth taking away from the visit, and it is specific about what
	 * to do next rather than telling them their device is unsupported.
	 */
	import Icon from '$lib/components/ui/icon.svelte';
	import { GithubIcon, LaptopIcon } from '@hugeicons/core-free-icons';
	import Wordmark from '$lib/components/brand/wordmark.svelte';
</script>

<div class="relative min-h-dvh overflow-hidden bg-background">
	<!-- The same glow as the desktop landing page, so somebody who opens the
	     link on both does not meet two different products. -->
	<div class="pointer-events-none absolute inset-x-0 top-0 h-[34rem]" aria-hidden="true">
		<div
			class="absolute top-[-16rem] left-1/2 size-[38rem] -translate-x-1/2 rounded-full bg-primary/12 blur-3xl dark:bg-primary/20"
		></div>
		<div
			class="absolute top-[-10rem] left-[15%] size-[22rem] -translate-x-1/2 rounded-full bg-chart-2/8 blur-3xl dark:bg-chart-2/12"
		></div>
	</div>

	<div class="relative flex min-h-dvh flex-col px-6 pt-10 pb-8">
		<Wordmark size="md" />

		<div class="flex flex-1 flex-col justify-center gap-7 py-10">
			<div class="space-y-3">
				<h1 class="text-4xl leading-[1.1] font-semibold tracking-tight text-balance">
					Agentic OCR that turns
					<span class="text-accent-ink">paper into spreadsheets</span>
				</h1>
				<p class="text-base leading-relaxed text-pretty text-muted-foreground">
					A PDF, a photograph, a bad scan. Every table and the detail around it, into a working
					Excel file — with the totals checked by running the arithmetic.
				</p>
			</div>

			<!--
				The one piece of new information on this page, so it is the one
				thing with a container round it.
			-->
			<div class="rounded-2xl border bg-card/70 p-5 shadow-sm backdrop-blur-sm">
				<h2 class="flex items-center gap-2.5 font-medium">
					<Icon icon={LaptopIcon} size={19} class="shrink-0 text-accent-ink" />
					Open this on a computer
				</h2>
				<p class="mt-2.5 text-sm leading-relaxed text-muted-foreground">
					Rowbot puts the workbook, the page it came from and the conversation side by side, so you
					can check any figure against the paper without losing your place. That needs a wider
					screen than a phone has.
				</p>
				<p class="mt-3 text-sm leading-relaxed text-muted-foreground">
					Go to
					<span class="font-medium text-foreground">rowbot.sh</span>
					on a laptop or desktop to sign in and get started.
				</p>
			</div>

			<p class="text-sm text-muted-foreground">
				A version that works on a phone is coming. This one would only have pretended to.
			</p>
		</div>

		<footer
			class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-5 text-sm text-muted-foreground"
		>
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
				By
				<a
					href="https://www.linkedin.com/in/elham-aboutorabi/"
					target="_blank"
					rel="noreferrer"
					class="font-medium text-foreground underline-offset-4 hover:underline"
				>
					Eli Aboutorabi
				</a>
			</span>
		</footer>
	</div>
</div>
