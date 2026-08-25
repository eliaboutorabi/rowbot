import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, `/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`);
	}
	return { user: locals.user };
};
