import { redirect } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { document } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
	const rows = await db
		.select({
			id: document.id,
			name: document.name,
			originalFilename: document.originalFilename,
			mimeType: document.mimeType,
			sizeBytes: document.sizeBytes,
			pageCount: document.pageCount,
			status: document.status,
			createdAt: document.createdAt,
			sheetCount: sql<number>`(
				select json_array_length(json_extract(w.data_json, '$.sheets'))
				from workbook w
				where w.document_id = ${document.id}
				order by w.version desc
				limit 1
			)`
		})
		.from(document)
		.where(eq(document.userId, locals.user!.id))
		.orderBy(desc(document.createdAt))
		.limit(100);

	return { documents: rows };
};

export const actions: Actions = {
	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		redirect(302, '/sign-in');
	}
};
