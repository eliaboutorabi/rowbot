<script lang="ts">
	import { enhance } from '$app/forms';
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
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let saving = $state(false);
	let removing = $state(false);

	const allowance = $derived(data.allowance);
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
</script>

<svelte:head><title>Settings · Rowbot</title></svelte:head>

<div class="mx-auto w-full max-w-2xl px-6 py-12">
	<header class="mb-8">
		<h1 class="text-3xl font-semibold tracking-tight">Settings</h1>
		<p class="mt-2 text-muted-foreground">
			What this account is allowed to spend, and whose keys it spends it on.
		</p>
	</header>

	<!-- Allowance ------------------------------------------------------- -->
	<section class="rounded-xl border bg-card p-5">
		<div class="flex items-start gap-3">
			<span
				class="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"
			>
				<HugeiconsIcon icon={allowance.tier === 'free' ? Coins01Icon : SparklesIcon} size={17} />
			</span>
			<div class="min-w-0 flex-1">
				<h2 class="font-medium">{tier.label}</h2>
				<p class="mt-1 text-sm text-muted-foreground">{tier.blurb}</p>
			</div>
		</div>

		<div class="mt-5 grid gap-4 sm:grid-cols-3">
			<Meter label="Documents" used={allowance.documents.used} limit={allowance.documents.limit} />
			<Meter label="Agent turns" used={allowance.turns.used} limit={allowance.turns.limit} />
			<Meter label="Pages per document" used={null} limit={allowance.pageLimit} />
		</div>
	</section>

	<!-- Keys ------------------------------------------------------------ -->
	<section class="mt-6 rounded-xl border bg-card p-5">
		<div class="flex items-start gap-3">
			<span
				class="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"
			>
				<HugeiconsIcon icon={Key01Icon} size={17} />
			</span>
			<div class="min-w-0 flex-1">
				<h2 class="font-medium">Your API keys</h2>
				<p class="mt-1 text-sm text-muted-foreground">
					Save both and Rowbot uses them instead of mine, with no limits. They are encrypted before
					they are stored and never shown again — only the last four characters.
				</p>
			</div>
		</div>

		{#if form?.message}
			<p
				class="mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm {form.saved
					? 'border-primary/30 bg-primary/8 text-foreground'
					: 'border-destructive/30 bg-destructive/8 text-destructive'}"
				role="status"
			>
				<HugeiconsIcon
					icon={form.saved ? CheckmarkCircle02Icon : Alert01Icon}
					size={16}
					class="mt-0.5 shrink-0"
				/>
				{form.message}
			</p>
		{/if}

		<form
			method="post"
			action="?/save"
			class="mt-5 space-y-4"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update();
					saving = false;
				};
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
				{#if form?.openaiError}
					<p class="text-xs text-destructive">{form.openaiError}</p>
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
				{#if form?.mistralError}
					<p class="text-xs text-destructive">{form.mistralError}</p>
				{/if}
			</div>

			<div class="flex items-center gap-2 pt-1">
				<Button type="submit" disabled={saving}>
					{#if saving}
						<HugeiconsIcon icon={Loading03Icon} size={16} class="animate-spin" />
						Checking the keys…
					{:else}
						Save keys
					{/if}
				</Button>

				{#if hasKeys}
					<!-- Submits the sibling form below: a <form> cannot nest. -->
					<Button type="submit" form="remove-keys" variant="ghost" disabled={removing}>
						<HugeiconsIcon icon={Delete02Icon} size={16} />
						{removing ? 'Removing…' : 'Remove'}
					</Button>
				{/if}
			</div>
		</form>

		{#if hasKeys}
			<form
				id="remove-keys"
				method="post"
				action="?/remove"
				use:enhance={() => {
					removing = true;
					return async ({ update }) => {
						await update();
						removing = false;
					};
				}}
			></form>
		{/if}

		<p class="mt-4 border-t pt-4 text-xs text-muted-foreground">
			Keys are encrypted with AES-256-GCM under a key derived from the server secret, held in memory
			only for the duration of a run, and never written to a checkpoint.
		</p>
	</section>
</div>
