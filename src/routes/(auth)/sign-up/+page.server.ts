import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { isValidInvite, signUpOpen } from '$lib/server/invites';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(302, '/documents');
	return { open: signUpOpen() };
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const name = form.get('name')?.toString().trim() ?? '';
		const email = form.get('email')?.toString().trim() ?? '';
		const password = form.get('password')?.toString() ?? '';
		const invite = form.get('invite')?.toString() ?? '';

		// The invite is never echoed back into the form: a wrong code should not
		// be left sitting in the field for a script to iterate on.
		const values = { name, email };

		if (!signUpOpen()) {
			return fail(403, { ...values, message: 'Rowbot is not accepting new accounts right now.' });
		}
		if (!isValidInvite(invite)) {
			return fail(403, {
				...values,
				message:
					'That invite code is not valid. Rowbot is invite-only while it runs on my API keys.'
			});
		}
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
