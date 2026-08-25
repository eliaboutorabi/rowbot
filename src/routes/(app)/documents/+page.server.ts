import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { auth } from '$lib/server/auth';

/**
 * The library itself is loaded by the app layout, because the rail's
 * recent-projects panel needs the same list from every page. This route only
 * hosts sign-out.
 */
export const actions: Actions = {
	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		redirect(302, '/sign-in');
	}
};
