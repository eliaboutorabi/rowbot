<script lang="ts">
	/**
	 * Every thrown error and every unmatched URL lands here, signed in or not,
	 * so it cannot assume the app shell around it — it paints its own ground and
	 * carries its own way out.
	 *
	 * The copy is written per status rather than printing whatever the server
	 * said. A 404 is a wrong address and a 500 is our fault, and those want
	 * different sentences and different exits; a raw framework message tells the
	 * reader neither.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/icon.svelte';
	import { ArrowLeft01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import Logo from '$lib/components/brand/logo.svelte';

	const copy = $derived.by(() => {
		switch (page.status) {
			case 404:
				return {
					title: 'Nothing at this address',
					body: 'The page you asked for does not exist — or the document behind it has since been deleted.'
				};
			case 401:
			case 403:
				return {
					title: 'Not your document',
					body: 'You are signed in, but this belongs to another account.'
				};
			case 402:
				return {
					title: 'Out of allowance',
					body: 'This account has used its free run. Add your own API keys in Settings and Rowbot will use those instead.'
				};
			case 429:
				return {
					title: 'Too many requests',
					body: 'Give it a moment and try again.'
				};
			default:
				return {
					title: 'Something broke on our side',
					body:
						page.error?.message ??
						'The server did not finish the request. Reloading usually clears it.'
				};
		}
	});

	const isServerFault = $derived(page.status >= 500);
</script>

<svelte:head><title>{copy.title} · Rowbot</title></svelte:head>

<div class="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-16">
	<div class="w-full max-w-md text-center">
		<Logo class="mx-auto size-12 text-muted-foreground" />

		<p class="mt-6 font-mono text-xs tracking-widest text-muted-foreground uppercase">
			Error {page.status}
		</p>
		<h1 class="mt-2 text-2xl font-semibold tracking-tight text-balance">{copy.title}</h1>
		<p class="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
			{copy.body}
		</p>

		<div class="mt-7 flex flex-wrap items-center justify-center gap-2">
			<Button href={resolve('/documents')} class="gap-2">
				<Icon icon={ArrowLeft01Icon} size={15} />
				Back to your documents
			</Button>
			{#if isServerFault}
				<Button variant="outline" class="gap-2" onclick={() => location.reload()}>
					<Icon icon={RefreshIcon} size={15} />
					Try again
				</Button>
			{/if}
			{#if page.status === 402}
				<Button href={resolve('/settings')} variant="outline">Open Settings</Button>
			{/if}
		</div>
	</div>
</div>
