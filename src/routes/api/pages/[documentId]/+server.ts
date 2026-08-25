import { error, json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { documentPage } from '$lib/server/db/schema';
import { ownedDocument } from '$lib/server/runs';
import type { OcrBlock, OcrTable } from '$lib/server/ocr/mistral';
import { tablePath } from '$lib/server/agent/tools/ocr';

/**
 * Mistral's page segmentation, for the source viewer's overlay.
 *
 * Every block already carries its bounding box, its type and its own
 * confidence — this has been persisted since the first OCR pass and simply
 * never read back. Table blocks carry a `table_id` that joins them to the
 * table that became a sheet, which is what makes a block clickable.
 *
 * Served as its own endpoint rather than folded into the page load: the
 * blocks are large, and nothing on first paint needs them.
 */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) error(401, 'Sign in first.');

	const doc = await ownedDocument(params.documentId, locals.user.id);

	const rows = await db
		.select()
		.from(documentPage)
		.where(eq(documentPage.documentId, doc.id))
		.orderBy(asc(documentPage.pageIndex));

	// `?raw` hands back exactly what Mistral returned, for the JSON export.
	if (url.searchParams.has('raw')) {
		return json(
			{
				document: { id: doc.id, name: doc.name, filename: doc.originalFilename },
				model: doc.ocrModel,
				pageCount: doc.pageCount,
				pages: rows.map((row) => ({
					index: row.pageIndex,
					markdown: row.markdown,
					header: row.header,
					footer: row.footer,
					dimensions: { width: row.width, height: row.height, dpi: row.dpi },
					confidence: { average: row.avgConfidence, minimum: row.minConfidence },
					tables: row.tablesJson,
					blocks: row.blocksJson
				}))
			},
			{
				headers: {
					'content-disposition': `attachment; filename="${doc.name} — OCR.json"`
				}
			}
		);
	}

	return json({
		pageCount: doc.pageCount ?? rows.length,
		model: doc.ocrModel,
		pages: rows.map((row) => {
			const blocks = (row.blocksJson ?? []) as OcrBlock[];
			const tables = (row.tablesJson ?? []) as OcrTable[];

			return {
				index: row.pageIndex,
				width: row.width,
				height: row.height,
				averageConfidence: row.avgConfidence,
				minimumConfidence: row.minConfidence,
				tableIds: tables.map((table) => table.id),
				blocks: blocks.map((block) => ({
					type: block.type,
					// Same helper the importer used, so a block joins to its sheet.
					tablePath: block.table_id ? tablePath(row.pageIndex, block.table_id) : null,
					// Trimmed hard: the overlay shows a label on hover, not the page.
					preview: (block.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
					confidence: block.confidence_scores?.average_confidence_score ?? null,
					box: {
						x: block.top_left_x,
						y: block.top_left_y,
						width: block.bottom_right_x - block.top_left_x,
						height: block.bottom_right_y - block.top_left_y
					}
				}))
			};
		})
	});
};
