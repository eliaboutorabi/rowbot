<script lang="ts">
	/**
	 * Settings, as a column rather than a page.
	 *
	 * It renders inside the sidebar, where it has about three hundred pixels and
	 * no room for a page header — the rail already says where you are. It keeps
	 * its own submission state and posts to `/settings`'s actions by absolute
	 * path, so it works from the library, from a workspace, from anywhere the
	 * rail is, which is everywhere.
	 */
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Alert01Icon,
		CheckmarkCircle02Icon,
		Coins01Icon,
		Delete02Icon,
		Key01Icon,
		Loading03Icon,
		SparklesIcon
	} from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import Meter from '$lib/components/app/meter.svelte';

	interface Allowance {
		tier: string;
		documents: { used: number | null; limit: number | null };
		turns: { used: number | null; limit: number | null };
		pageLimit: number | null;
		keyHints: { openai?: string | null; mistral?: string | null };
	}

	let { allowance }: { allowance: Allowance } = $props();

	let saving = $state(false);
	let removing = $state(false);

	/** The last action's outcome. Held here so the panel works off-route. */
	let result = $state<{
		message?: string;
		saved?: boolean;
		openaiError?: string;
		mistralError?: string;
	} | null>(null);

	const hasKeys = $derived(Boolean(allowance.keyHints.openai || allowance.keyHints.mistral));

	const TIER_COPY: Record<string, { label: string; blurb: string }> = {
		free: {
			label: 'Free allowance',
			blurb: 'Running on my API keys, so it is rationed. Add your own below to lift the limits.'
		},
		byok: {
			label: 'Your own keys',
			blurb: 'Every run bills your OpenAI and Mistral accounts. Nothing is metered.'
		},
		unlimited: {
			label: 'Operator',
			blurb: 'This address is on the unlimited list. Runs bill the platform keys.'
		}
	};

	const tier = $derived(TIER_COPY[allowance.tier]);

	/**
	 * One handler for both forms. `invalidateAll` is what refreshes the
	 * allowance above after a key is saved or removed — without it the panel
	 * would report success and go on showing the old tier.
	 */
	function submit(done: () => void) {
		return async ({ result: outcome }: { result: { type: string; data?: unknown } }) => {
			result = (outcome.data as typeof result) ?? null;
			if (outcome.type === 'success') await invalidateAll();
			done();
		};
	}
</script>

<div class="scroll-slim flex h-full flex-col gap-5 overflow-y-auto p-4">
	<!-- Allowance ------------------------------------------------------- -->
	<section>
		<div class="flex items-start gap-2.5">
			<span
				class="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"
			>
				<HugeiconsIcon icon={allowance.tier === 'free' ? Coins01Icon : SparklesIcon} size={16} />
			</span>
			<div class="min-w-0 flex-1">
				<h2 class="text-sm font-medium">{tier.label}</h2>
				<p class="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{tier.blurb}</p>
			</div>
		</div>

		<!-- Stacked, not a three-column grid: this is a column now. -->
		<div class="mt-4 space-y-3">
			<Meter label="Documents" used={allowance.documents.used} limit={allowance.documents.limit} />
			<Meter label="Agent turns" used={allowance.turns.used} limit={allowance.turns.limit} />
			<Meter label="Pages per document" used={null} limit={allowance.pageLimit} />
		</div>
	</section>

	<!-- Keys ------------------------------------------------------------ -->
	<section class="border-t pt-5">
		<div class="flex items-start gap-2.5">
			<span
				class="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"
			>
				<HugeiconsIcon icon={Key01Icon} size={16} />
			</span>
			<div class="min-w-0 flex-1">
				<h2 class="text-sm font-medium">Your API keys</h2>
				<p class="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
					Save both and Rowbot uses them instead of mine, with no limits. They are encrypted before
					they are stored and never shown again — only the last four characters.
				</p>
			</div>
		</div>

		{#if result?.message}
			<p
				class="mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[0.8125rem] {result.saved
					? 'border-primary/30 bg-primary/8 text-foreground'
					: 'border-destructive/30 bg-destructive/8 text-destructive'}"
				role="status"
			>
				<HugeiconsIcon
					icon={result.saved ? CheckmarkCircle02Icon : Alert01Icon}
					size={15}
					class="mt-0.5 shrink-0"
				/>
				{result.message}
			</p>
		{/if}

		<form
			method="post"
			action="/settings?/save"
			class="mt-4 space-y-4"
			use:enhance={() => {
				saving = true;
				return submit(() => (saving = false));
			}}
		>
			<div class="space-y-2">
				<div class="flex items-baseline justify-between gap-3">
					<Label for="openai">OpenAI API key</Label>
					{#if allowance.keyHints.openai}
						<span class="font-mono text-xs text-muted-foreground">
							saved · {allowance.keyHints.openai}
						</span>
					{/if}
				</div>
				<Input
					id="openai"
					name="openai"
					type="password"
					autocomplete="off"
					spellcheck={false}
					placeholder={allowance.keyHints.openai ? 'Enter a new key to replace it' : 'sk-…'}
				/>
				{#if result?.openaiError}
					<p class="text-xs text-destructive">{result.openaiError}</p>
				{/if}
			</div>

			<div class="space-y-2">
				<div class="flex items-baseline justify-between gap-3">
					<Label for="mistral">Mistral API key</Label>
					{#if allowance.keyHints.mistral}
						<span class="font-mono text-xs text-muted-foreground">
							saved · {allowance.keyHints.mistral}
						</span>
					{/if}
				</div>
				<Input
					id="mistral"
					name="mistral"
					type="password"
					autocomplete="off"
					spellcheck={false}
					placeholder={allowance.keyHints.mistral
						? 'Enter a new key to replace it'
						: 'Your Mistral key'}
				/>
				{#if result?.mistralError}
					<p class="text-xs text-destructive">{result.mistralError}</p>
				{/if}
			</div>

			<div class="flex flex-wrap items-center gap-2 pt-1">
				<Button type="submit" size="sm" disabled={saving}>
					{#if saving}
						<HugeiconsIcon icon={Loading03Icon} size={15} class="animate-spin" />
						Checking the keys…
					{:else}
						Save keys
					{/if}
				</Button>

				{#if hasKeys}
					<!-- Submits the sibling form below: a <form> cannot nest. -->
					<Button type="submit" form="remove-keys" size="sm" variant="ghost" disabled={removing}>
						<HugeiconsIcon icon={Delete02Icon} size={15} />
						{removing ? 'Removing…' : 'Remove'}
					</Button>
				{/if}
			</div>
		</form>

		{#if hasKeys}
			<form
				id="remove-keys"
				method="post"
				action="/settings?/remove"
				use:enhance={() => {
					removing = true;
					return submit(() => (removing = false));
				}}
			></form>
		{/if}

		<p class="mt-4 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
			Keys are encrypted with AES-256-GCM under a key derived from the server secret, held in memory
			only for the duration of a run, and never written to a checkpoint.
		</p>
	</section>
</div>
