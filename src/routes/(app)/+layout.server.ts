import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { allowanceFor } from '$lib/server/entitlements';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, `/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`);
	}

	// Every page in the workspace wants to know what is left in the allowance —
	// the dropzone to warn before an upload, the composer to warn before a turn.
	return { user: locals.user, allowance: await allowanceFor(locals.user) };
};
