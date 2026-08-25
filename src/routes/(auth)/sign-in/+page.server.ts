import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(302, url.searchParams.get('next') ?? '/documents');
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const email = form.get('email')?.toString().trim() ?? '';
		const password = form.get('password')?.toString() ?? '';

		if (!email || !password) {
			return fail(400, { email, message: 'Enter your email and password.' });
		}

		try {
			await auth.api.signInEmail({ body: { email, password }, headers: event.request.headers });
		} catch (cause) {
			if (cause instanceof APIError) {
				// Don't reveal whether the address exists.
				return fail(400, { email, message: 'That email and password combination did not work.' });
			}
			console.error('[rowbot] sign-in failed', cause);
			return fail(500, { email, message: 'Something went wrong. Try again in a moment.' });
		}

		redirect(302, event.url.searchParams.get('next') ?? '/documents');
	}
};
