<script lang="ts">
	/**
	 * Settings is a sidebar panel now, opened from the rail. This route stays
	 * because it hosts the form actions the panel posts to, and because
	 * "Add your API keys" in a failed run wants somewhere to link to. Same
	 * component either way, so the two can never drift apart.
	 */
	import SettingsPanel from '$lib/components/app/settings-panel.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Settings · Rowbot</title></svelte:head>

<div class="mx-auto w-full max-w-2xl px-6 py-10">
	<header class="mb-2 px-4">
		<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
		<p class="mt-2 text-muted-foreground">
			What this account is allowed to spend, and whose keys it spends it on.
		</p>
	</header>

	<SettingsPanel allowance={data.allowance} />
</div>
