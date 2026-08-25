<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Alert01Icon, Loading03Icon } from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>Create an account · Rowbot</title></svelte:head>

<div class="space-y-2 text-center">
	<h1 class="text-2xl font-semibold tracking-tight">Create your account</h1>
	<p class="text-sm text-muted-foreground">Free to start. No card, no setup.</p>
</div>

<form
	method="post"
	class="mt-8 space-y-4"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update();
			submitting = false;
		};
	}}
>
	{#if form?.message}
		<p
			class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-sm text-destructive"
			role="alert"
		>
			<HugeiconsIcon icon={Alert01Icon} size={16} class="mt-0.5 shrink-0" />
			{form.message}
		</p>
	{/if}

	<div class="space-y-2">
		<Label for="name">Name</Label>
		<Input
			id="name"
			name="name"
			autocomplete="name"
			required
			value={form?.name ?? ''}
			placeholder="Ada Lovelace"
		/>
	</div>

	<div class="space-y-2">
		<Label for="email">Email</Label>
		<Input
			id="email"
			name="email"
			type="email"
			autocomplete="email"
			required
			value={form?.email ?? ''}
			placeholder="you@company.com"
		/>
	</div>

	<div class="space-y-2">
		<Label for="password">Password</Label>
		<Input
			id="password"
			name="password"
			type="password"
			autocomplete="new-password"
			required
			minlength={8}
			placeholder="At least 8 characters"
		/>
	</div>

	<Button type="submit" class="w-full" disabled={submitting}>
		{#if submitting}
			<HugeiconsIcon icon={Loading03Icon} size={16} class="animate-spin" />
			Creating account…
		{:else}
			Create account
		{/if}
	</Button>
</form>

<p class="mt-6 text-center text-sm text-muted-foreground">
	Already have an account?
	<a
		href={resolve('/sign-in')}
		class="font-medium text-foreground underline-offset-4 hover:underline">Sign in</a
	>
</p>
