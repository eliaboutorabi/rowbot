<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/ui/icon.svelte';
	import { Alert01Icon, Loading03Icon } from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>Sign in · Rowbot</title></svelte:head>

<div class="space-y-2">
	<h1 class="text-[1.75rem] leading-tight font-semibold tracking-tight">Welcome back</h1>
	<p class="text-sm text-muted-foreground">Pick up where you left off.</p>
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
			<Icon icon={Alert01Icon} size={16} class="mt-0.5 shrink-0" />
			{form.message}
		</p>
	{/if}

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
			autocomplete="current-password"
			required
			placeholder="••••••••"
		/>
	</div>

	<Button type="submit" class="w-full" disabled={submitting}>
		{#if submitting}
			<Icon icon={Loading03Icon} size={16} class="animate-spin" />
			Signing in…
		{:else}
			Sign in
		{/if}
	</Button>
</form>

<p class="mt-8 border-t pt-6 text-sm text-muted-foreground">
	New here?
	<a
		href={resolve('/sign-up')}
		class="font-medium text-accent-ink underline-offset-4 hover:underline"
	>
		Create an account
	</a>
</p>
