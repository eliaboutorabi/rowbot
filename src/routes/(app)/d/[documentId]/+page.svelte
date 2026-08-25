<script lang="ts">
	import Workspace from '$lib/components/app/workspace.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<!-- A fresh workspace per document: no transcript or run state carries over. -->
{#key data.document.id}
	<Workspace {data} />
{/key}
