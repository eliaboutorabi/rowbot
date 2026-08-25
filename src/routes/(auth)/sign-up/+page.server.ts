import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(302, '/documents');
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const name = form.get('name')?.toString().trim() ?? '';
		const email = form.get('email')?.toString().trim() ?? '';
		const password = form.get('password')?.toString() ?? '';

		const values = { name, email };
		if (!name) return fail(400, { ...values, message: 'What should we call you?' });
		if (!email) return fail(400, { ...values, message: 'Enter an email address.' });
		if (password.length < 8) {
			return fail(400, { ...values, message: 'Passwords need at least 8 characters.' });
		}

		try {
			await auth.api.signUpEmail({
				body: { name, email, password },
				headers: event.request.headers
			});
		} catch (cause) {
			if (cause instanceof APIError) {
				return fail(400, { ...values, message: cause.message || 'Could not create that account.' });
			}
			console.error('[rowbot] sign-up failed', cause);
			return fail(500, { ...values, message: 'Something went wrong. Try again in a moment.' });
		}

		redirect(302, '/documents');
	}
};
