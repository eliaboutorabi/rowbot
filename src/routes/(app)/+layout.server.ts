import { redirect } from '@sveltejs/kit';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';
import { document, run, workbook } from '$lib/server/db/schema';
import { allowanceFor } from '$lib/server/entitlements';
import { LIBRARY } from '$lib/library-data';

interface Built {
	sheets: number;
	/** What the agent named the workbook, which is rarely what the file was called. */
	title: string | null;
}

/** How far the conversation about a document got, and when it last moved. */
interface Conversation {
	turns: number;
	status: string;
	lastActiveAt: Date;
}

/**
 * The newest run per document.
 *
 * So the library can offer to pick a conversation back up: which project you
 * were last talking to, how far it got, and whether it is still going. Sorted
 * newest-first and taken once per document, the same shape as `builtWorkbooks`
 * and for the same reason — a correlated subquery binds the wrong `id`.
 */
async function conversations(documentIds: string[]): Promise<Map<string, Conversation>> {
	if (!documentIds.length) return new Map();

	const rows = await db
		.select({
			documentId: run.documentId,
			turns: run.turns,
			status: run.status,
			updatedAt: run.updatedAt
		})
		.from(run)
		.where(inArray(run.documentId, documentIds))
		.orderBy(desc(run.updatedAt));

	const found = new Map<string, Conversation>();
	for (const row of rows) {
		if (found.has(row.documentId)) continue;
		found.set(row.documentId, {
			turns: row.turns ?? 0,
			status: row.status,
			lastActiveAt: row.updatedAt
		});
	}
	return found;
}

/**
 * What each document turned into, read from its newest workbook version.
 *
 * Deliberately a second query rather than a correlated subquery: Drizzle
 * renders an interpolated column as a bare `"id"`, which inside a subquery
 * silently binds to the *inner* table's `id` and quietly returns nothing.
 */
async function builtWorkbooks(documentIds: string[]): Promise<Map<string, Built>> {
	if (!documentIds.length) return new Map();

	const rows = await db
		.select({
			documentId: workbook.documentId,
			sheets: sql<number | null>`json_array_length(json_extract(${workbook.dataJson}, '$.sheets'))`,
			title: sql<string | null>`json_extract(${workbook.dataJson}, '$.title')`,
			version: workbook.version
		})
		.from(workbook)
		.where(inArray(workbook.documentId, documentIds))
		.orderBy(desc(workbook.version));

	const built = new Map<string, Built>();
	// Rows arrive newest-first, so the first one seen per document wins.
	for (const row of rows) {
		if (built.has(row.documentId)) continue;
		built.set(row.documentId, { sheets: row.sheets ?? 0, title: row.title?.trim() || null });
	}
	return built;
}

/**
 * The library is loaded here rather than on `/documents`, because the rail's
 * recent-projects panel needs it from inside a workspace too — jumping
 * straight from one document to another without a trip through the library is
 * most of the point of that panel.
 */
export const load: LayoutServerLoad = async ({ locals, url, depends }) => {
	/**
	 * Nameable, because otherwise this runs once and never again.
	 *
	 * SvelteKit re-runs a layout load only when something it depends on
	 * changes, and for a signed-in reader this one touches neither `url` nor
	 * `params` — so it has no dependencies at all. The library was therefore
	 * fetched when the app first opened and kept for the rest of the session:
	 * upload a document, walk into it, come back, and you are looking at the
	 * list from before the upload. On a fresh account that means an empty
	 * library that stays empty however many files you add.
	 *
	 * Anything that changes what is in the library — an upload, a delete, a run
	 * that finishes and gives a document a title and some sheets — invalidates
	 * this key.
	 */
	depends(LIBRARY);

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

	const ids = rows.map((r) => r.id);
	const [built, chats] = await Promise.all([builtWorkbooks(ids), conversations(ids)]);

	// Every page in the workspace wants to know what is left in the allowance —
	// the dropzone to warn before an upload, the composer to warn before a turn.
	return {
		user: locals.user,
		allowance: await allowanceFor(locals.user),
		documents: rows.map((row) => {
			const made = built.get(row.id);
			const chat = chats.get(row.id);
			return {
				...row,
				sheetCount: made?.sheets ?? 0,
				/** Null where nobody has said anything to this document yet. */
				conversation: chat && chat.turns > 0 ? chat : null,
				/**
				 * What to call it on screen. The agent reads a title off the page —
				 * "Meridian Group — Global Sales Ledger FY2025" — and the library was
				 * showing "huge-ledger" instead, which is the name of the file
				 * somebody happened to save it under and says nothing about what is
				 * inside. The filename stays, one line down, because that is how you
				 * find the thing you uploaded.
				 */
				title: made?.title ?? null
			};
		})
	};
};
