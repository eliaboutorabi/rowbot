import { redirect } from '@sveltejs/kit';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';
import { document, workbook } from '$lib/server/db/schema';
import { allowanceFor } from '$lib/server/entitlements';

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

/**
 * The library is loaded here rather than on `/documents`, because the rail's
 * recent-projects panel needs it from inside a workspace too — jumping
 * straight from one document to another without a trip through the library is
 * most of the point of that panel.
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, `/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`);
	}

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
		.where(eq(document.userId, locals.user.id))
		.orderBy(desc(document.createdAt))
		.limit(100);

	const counts = await sheetCounts(rows.map((r) => r.id));

	// Every page in the workspace wants to know what is left in the allowance —
	// the dropzone to warn before an upload, the composer to warn before a turn.
	return {
		user: locals.user,
		allowance: await allowanceFor(locals.user),
		documents: rows.map((row) => ({ ...row, sheetCount: counts.get(row.id) ?? 0 }))
	};
};
