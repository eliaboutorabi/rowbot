/**
 * The `ocr_document` tool: Mistral Document AI, wired into the harness.
 *
 * The tool does the mechanical work — call the model, chunk long documents so
 * each call fits inside a serverless invocation, persist the pages, drop the
 * results into the agent's virtual filesystem — and hands back an index. The
 * agent then reasons over that index to decide how the workbook should be
 * shaped, which is the part that actually needs judgement.
 */
import { tool, type ToolRuntime } from '@langchain/core/tools';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';
import { and, count, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document as documentTable, documentPage } from '$lib/server/db/schema';
import { readDocument } from '$lib/server/storage';
import { OCR_MODEL, pageRanges, pdfPageCount, runOcr, type OcrPage } from '$lib/server/ocr/mistral';
import { parseTableHtml } from '$lib/server/ocr/html-table';
import type { OcrIndex, OcrTableIndexEntry, RowbotContext } from '../state';
import { emitProgress } from '../events';

/** Pages per Mistral call. Keeps each request comfortably inside the limit. */
const CHUNK_PAGES = 10;

const fileEntry = (content: string, mimeType: string) => ({
	content,
	mimeType,
	created_at: new Date().toISOString(),
	modified_at: new Date().toISOString()
});

export const pagePath = (index: number) => `/source/page-${index + 1}.md`;
export const tablePath = (pageIndex: number, tableId: string) =>
	`/source/tables/page-${pageIndex + 1}-${tableId.replace(/\.(html|md)$/, '')}.html`;

function summarizePage(page: OcrPage, files: Record<string, unknown>): OcrTableIndexEntry[] {
	const entries: OcrTableIndexEntry[] = [];

	files[pagePath(page.index)] = fileEntry(
		[
			`# Page ${page.index + 1}`,
			page.header ? `\n> Header: ${page.header}` : '',
			page.footer ? `> Footer: ${page.footer}` : '',
			'',
			page.markdown
		]
			.filter(Boolean)
			.join('\n'),
		'text/markdown'
	);

	for (const table of page.tables ?? []) {
		const path = tablePath(page.index, table.id);
		files[path] = fileEntry(table.content, 'text/html');

		const parsed = parseTableHtml(table.content);
		const firstRow = parsed.rows[0] ?? [];
		entries.push({
			pageIndex: page.index,
			tableId: table.id,
			path,
			rows: parsed.rows.length,
			columns: parsed.width,
			preview: firstRow
				.map((cell) => (cell.v == null ? '' : String(cell.v)))
				.join(' | ')
				.slice(0, 200)
		});
	}

	return entries;
}

/**
 * Writes a pass of OCR into `document_page`, replacing only the pages it read.
 *
 * This used to delete every page of the document before inserting, which is
 * right for a full pass and destructive for any other kind. The tool takes a
 * page range, the agent is told to retry with a smaller one when a read fails,
 * and a long document is read in chunks — so a second, narrower pass silently
 * erased the segmentation for every page it did not cover. The source view
 * then opened on page two of a document whose first page it no longer had.
 *
 * Returns how many pages of this document we now hold a read for.
 */
export async function replacePages(
	documentId: string,
	rows: (typeof documentPage.$inferInsert)[]
): Promise<number> {
	if (rows.length) {
		await db.delete(documentPage).where(
			and(
				eq(documentPage.documentId, documentId),
				inArray(
					documentPage.pageIndex,
					rows.map((row) => row.pageIndex)
				)
			)
		);
		await db.insert(documentPage).values(rows);
	}

	const [held] = await db
		.select({ pages: count() })
		.from(documentPage)
		.where(eq(documentPage.documentId, documentId));

	return held?.pages ?? 0;
}

const schema = z.object({
	pages: z
		.string()
		.optional()
		.describe(
			'Optional page selection using zero-based numbers and ranges, e.g. "0", "0-4" or "0,2-4". Omit to read the whole document.'
		),
	reason: z
		.string()
		.optional()
		.describe('Why you are running OCR now. Shown to the user in the activity feed.')
});

export const ocrDocumentTool = tool(
	async ({ pages, reason }, runtime: ToolRuntime<never, RowbotContext>) => {
		const ctx = runtime.context;
		const emit = emitProgress(runtime);

		const [doc] = await db
			.select()
			.from(documentTable)
			.where(eq(documentTable.id, ctx.documentId))
			.limit(1);

		if (!doc) return 'That document no longer exists.';
		if (!doc.blobUrl) return 'That document has no stored file to read.';

		emit({ kind: 'ocr:start', label: reason ?? 'Reading the document', pages: pages ?? 'all' });

		const bytes = await readDocument(doc.blobUrl);
		const totalPages = pdfPageCount(bytes, doc.mimeType) ?? 1;

		// Long documents are split so no single call risks the function timeout.
		const chunks =
			pages !== undefined
				? [pages]
				: totalPages > CHUNK_PAGES
					? pageRanges(totalPages, CHUNK_PAGES)
					: [undefined];

		const files: Record<string, unknown> = {};
		const tables: OcrTableIndexEntry[] = [];
		const pagesWithoutTables: number[] = [];
		const confidences: number[] = [];
		const dbRows: (typeof documentPage.$inferInsert)[] = [];
		const failedRanges: { range: string | undefined; reason: string }[] = [];
		let processed = 0;

		for (const [i, range] of chunks.entries()) {
			emit({
				kind: 'ocr:chunk',
				label:
					chunks.length > 1 ? `Pages ${range} (${i + 1} of ${chunks.length})` : 'Reading all pages',
				index: i,
				total: chunks.length
			});

			// A chunk that will not read must not take the ones that did. Mistral
			// has already been retried through its transient failures by this
			// point, so arriving here means the range genuinely did not come
			// back — and the useful thing is to keep the rest of the document,
			// tell the model which pages are missing, and let it decide whether
			// to try them again or work without them. Throwing instead ends the
			// run, which is how a 503 on page 4 of 6 used to lose all six.
			let result;
			try {
				result = await runOcr(bytes, doc.mimeType, doc.originalFilename, {
					pages: range,
					signal: runtime.config?.signal
				});
			} catch (cause) {
				if ((cause as Error)?.name === 'AbortError') throw cause;
				failedRanges.push({ range, reason: (cause as Error).message });
				emit({ kind: 'note', text: `Pages ${range ?? 'all'} could not be read` });
				continue;
			}
			processed += result.usage_info.pages_processed;

			for (const page of result.pages) {
				const found = summarizePage(page, files);
				if (found.length) tables.push(...found);
				else pagesWithoutTables.push(page.index);

				const avg = page.confidence_scores?.average_page_confidence_score;
				if (typeof avg === 'number') confidences.push(avg);

				dbRows.push({
					documentId: doc.id,
					pageIndex: page.index,
					markdown: page.markdown,
					header: page.header ?? null,
					footer: page.footer ?? null,
					width: page.dimensions?.width ?? null,
					height: page.dimensions?.height ?? null,
					dpi: page.dimensions?.dpi ?? null,
					avgConfidence: avg ?? null,
					minConfidence: page.confidence_scores?.minimum_page_confidence_score ?? null,
					tablesJson: (page.tables ?? []) as unknown[],
					blocksJson: (page.blocks ?? []) as unknown[]
				});

				emit({
					kind: 'ocr:page',
					page: page.index,
					tables: found.length,
					confidence: avg ?? null
				});
			}
		}

		// Nothing came back at all. Leave the previous read — and the document's
		// status — exactly as they were, and hand the model a result it can act
		// on rather than an exception that ends the run.
		if (!dbRows.length && failedRanges.length) {
			return [
				`OCR did not return anything for this document after retrying.`,
				...failedRanges.map((f) => `- pages ${f.range ?? 'all'}: ${f.reason}`),
				'',
				'This is the reader failing, not the document. Try `ocr_document` again with a',
				'smaller page range; if it keeps failing, say so plainly and stop rather than',
				'building a workbook out of nothing.'
			].join('\n');
		}

		const held = await replacePages(doc.id, dbRows);

		await db
			.update(documentTable)
			.set({
				status: 'ready',
				pageCount: totalPages,
				ocrModel: OCR_MODEL,
				// How many pages of this document we hold a read for, not how many
				// this call happened to read — otherwise re-reading one page of a
				// forty-page report records the document as one page processed.
				ocrPagesProcessed: held
			})
			.where(eq(documentTable.id, doc.id));

		const index: OcrIndex = {
			model: OCR_MODEL,
			pageCount: totalPages,
			pagesProcessed: processed,
			tables,
			pagesWithoutTables,
			averageConfidence: confidences.length
				? confidences.reduce((a, b) => a + b, 0) / confidences.length
				: null
		};

		emit({ kind: 'ocr:done', tables: tables.length, pages: processed });

		const lines = [
			`Read ${processed} page${processed === 1 ? '' : 's'} with ${OCR_MODEL}.`,
			...(failedRanges.length
				? [
						`${failedRanges.length} page range${failedRanges.length === 1 ? '' : 's'} did not come back: ` +
							failedRanges.map((f) => f.range ?? 'all').join(', ') +
							'. Everything below is what did read. Call `ocr_document` again on those ' +
							'pages before you finish, and tell the reviewer if they still will not read.'
					]
				: []),
			`Found ${tables.length} table${tables.length === 1 ? '' : 's'}.`,
			index.averageConfidence !== null
				? `Average OCR confidence ${(index.averageConfidence * 100).toFixed(1)}%.`
				: '',
			'',
			tables.length ? 'Tables:' : 'No tables were detected.',
			...tables.map(
				(t) =>
					`- ${t.path} — page ${t.pageIndex + 1}, ${t.rows}×${t.columns}, header: ${t.preview || '(none)'}`
			),
			pagesWithoutTables.length
				? `\nPages with no table: ${pagesWithoutTables.map((p) => p + 1).join(', ')}. Their prose is in /source/page-N.md.`
				: ''
		];

		return new Command({
			update: {
				files,
				ocrIndex: index,
				messages: [
					{
						role: 'tool',
						content: lines.filter(Boolean).join('\n'),
						tool_call_id: runtime.toolCallId
					}
				]
			}
		});
	},
	{
		name: 'ocr_document',
		description:
			'Run Mistral Document AI over the uploaded file. Writes each page to /source/page-N.md and each detected table to /source/tables/*.html, then returns an index of what was found. Call this first. Call it again with a page range if a page needs a second look.',
		schema
	}
);
