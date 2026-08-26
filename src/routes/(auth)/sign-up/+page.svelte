<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/ui/icon.svelte';
	import {
		Alert01Icon,
		Loading03Icon,
		Mail01Icon,
		SquareLock01Icon,
		Ticket01Icon,
		UserIcon
	} from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>Create an account · Rowbot</title></svelte:head>

<div class="space-y-2">
	<h1 class="text-[1.75rem] leading-tight font-semibold tracking-tight">Create your account</h1>
	<p class="text-sm text-muted-foreground">
		{data.open
			? 'Invite-only while Rowbot runs on my API keys.'
			: 'Rowbot is not accepting new accounts right now.'}
	</p>
</div>

{#if !data.open}
	<p class="mt-8 rounded-lg border bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
		Sign-ups are closed. If you were sent here to look at my work, get in touch and I will open one
		up.
	</p>
{:else}
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
			<Label for="invite">Invite code</Label>
			<div class="relative">
				<Icon
					icon={Ticket01Icon}
					size={16}
					class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					id="invite"
					name="invite"
					required
					autocomplete="off"
					spellcheck={false}
					class="pl-9"
					placeholder="The code you were given"
					aria-describedby="invite-help"
				/>
			</div>
			<!-- Quiet on purpose: it answers the one question the field raises for
			     somebody who arrived without a code, and gets out of the way of
			     everybody who has one. -->
			<p id="invite-help" class="text-xs leading-relaxed text-muted-foreground">
				Not got one? Message
				<a
					href="https://www.linkedin.com/in/elham-aboutorabi/"
					target="_blank"
					rel="noreferrer"
					class="text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
				>
					Elham Aboutorabi
				</a>
				on LinkedIn and I will send you one.
			</p>
		</div>

		<div class="space-y-2">
			<Label for="name">Name</Label>
			<div class="relative">
				<Icon
					icon={UserIcon}
					size={16}
					class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					class="pl-9"
					id="name"
					name="name"
					autocomplete="name"
					required
					value={form?.name ?? ''}
					placeholder="Ada Lovelace"
				/>
			</div>
		</div>

		<div class="space-y-2">
			<Label for="email">Email</Label>
			<div class="relative">
				<Icon
					icon={Mail01Icon}
					size={16}
					class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					value={form?.email ?? ''}
					class="pl-9"
					placeholder="you@company.com"
				/>
			</div>
		</div>

		<div class="space-y-2">
			<Label for="password">Password</Label>
			<div class="relative">
				<Icon
					icon={SquareLock01Icon}
					size={16}
					class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					required
					minlength={8}
					class="pl-9"
					placeholder="At least 8 characters"
				/>
			</div>
		</div>

		<Button type="submit" class="w-full" disabled={submitting}>
			{#if submitting}
				<Icon icon={Loading03Icon} size={16} class="animate-spin" />
				Creating account…
			{:else}
				Create account
			{/if}
		</Button>
	</form>
{/if}

<p class="mt-8 border-t pt-6 text-sm text-muted-foreground">
	Already have an account?
	<a
		href={resolve('/sign-in')}
		class="font-medium text-accent-ink underline-offset-4 hover:underline">Sign in</a
	>
</p>
