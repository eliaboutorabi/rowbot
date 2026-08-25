<script lang="ts">
	/**
	 * One line of an allowance: how much of something has been used, out of how
	 * much is permitted.
	 *
	 * Three shapes, because they read differently. A metered value fills. An
	 * unmetered one (`limit === null`) and a plain ceiling (`used === null`) are
	 * facts rather than gauges, so they show a flat, quiet bar — a full-strength
	 * fill on an unlimited tier would read as "you have used it all".
	 */
	let { label, used, limit }: { label: string; used: number | null; limit: number | null } =
		$props();

	const gauge = $derived(limit !== null && used !== null);
	const fraction = $derived(gauge && limit! > 0 ? Math.min(1, used! / limit!) : 0);
	const spent = $derived(gauge && used! >= limit!);
</script>

<div>
	<div class="flex items-baseline justify-between gap-2">
		<span class="text-xs text-muted-foreground">{label}</span>
		<span class="font-mono text-xs {spent ? 'text-destructive' : 'text-foreground'}">
			{#if limit === null}
				∞
			{:else if used === null}
				{limit}
			{:else}
				{used}/{limit}
			{/if}
		</span>
	</div>
	<div class="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
		{#if gauge}
			<div
				class="h-full rounded-full transition-[width] duration-500 {spent
					? 'bg-destructive'
					: 'bg-primary'}"
				style:width="{fraction * 100}%"
			></div>
		{:else}
			<div class="h-full w-full rounded-full bg-muted-foreground/20"></div>
		{/if}
	</div>
</div>
