import { redirect } from '@sveltejs/kit';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { document, workbook } from '$lib/server/db/schema';

/**
 * Sheet counts for a set of documents, read from the newest workbook version
 * of each.
 *
 * Deliberately a second query rather than a correlated subquery: Drizzle
 * renders an interpolated column as a bare `"id"`, which inside a subquery
 * silently binds to the *inner* table's `id` and quietly returns nothing.
 */
async function sheetCounts(documentIds: string[]): Promise<Map<string, number>> {
	if (!documentIds.length) return new Map();

	const rows = await db
		.select({
			documentId: workbook.documentId,
			sheets: sql<number | null>`json_array_length(json_extract(${workbook.dataJson}, '$.sheets'))`,
			version: workbook.version
		})
		.from(workbook)
		.where(inArray(workbook.documentId, documentIds))
		.orderBy(desc(workbook.version));

	const counts = new Map<string, number>();
	// Rows arrive newest-first, so the first one seen per document wins.
	for (const row of rows) {
		if (counts.has(row.documentId)) continue;
		counts.set(row.documentId, row.sheets ?? 0);
	}
	return counts;
}

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
			createdAt: document.createdAt
		})
		.from(document)
		.where(eq(document.userId, locals.user!.id))
		.orderBy(desc(document.createdAt))
		.limit(100);

	const counts = await sheetCounts(rows.map((r) => r.id));

	return {
		documents: rows.map((row) => ({ ...row, sheetCount: counts.get(row.id) ?? 0 }))
	};
};

export const actions: Actions = {
	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		redirect(302, '/sign-in');
	}
};
