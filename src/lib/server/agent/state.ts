/**
 * Agent state and per-invocation context.
 *
 * `workbook` is checkpointed with the conversation, so an interrupted run
 * never loses accepted work. It is written through a reducer rather than
 * being overwritten — see `workbook-ops.ts` for why.
 */
import { ReducedValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import type { WorkbookModel } from '$lib/types/workbook';
import { applyOps, emptyModel, type WorkbookUpdate } from './workbook-ops';

export interface OcrTableIndexEntry {
	pageIndex: number;
	tableId: string;
	/** Virtual filesystem path holding the table's HTML. */
	path: string;
	rows: number;
	columns: number;
	/** First row of the table, so the agent can plan without opening the file. */
	preview: string;
}

export interface OcrIndex {
	model: string;
	pageCount: number;
	pagesProcessed: number;
	tables: OcrTableIndexEntry[];
	/** Pages that produced no table at all. */
	pagesWithoutTables: number[];
	averageConfidence: number | null;
}

export const rowbotStateSchema = new StateSchema({
	/**
	 * Written as a list of operations, not as a whole value. The model often
	 * issues several `import_table` calls in one step; a plain last-value
	 * channel would keep one and silently drop the rest.
	 */
	workbook: new ReducedValue(
		z.custom<WorkbookModel>().default(() => emptyModel()),
		{
			inputSchema: z.custom<WorkbookUpdate>(),
			reducer: (current: WorkbookModel, update: WorkbookUpdate) =>
				applyOps(current ?? emptyModel(), update)
		}
	),
	/**
	 * Same lesson as `workbook`, learned the hard way a second time.
	 *
	 * `ocr_document` takes a page range, and the model quite reasonably calls it
	 * twice in one step to read a long file in parallel. A last-value channel
	 * treats that as a conflict and aborts the whole graph with
	 * INVALID_CONCURRENT_GRAPH_UPDATE, which loses the run — including the
	 * pages that read perfectly well. Merging is both the safe answer and the
	 * right one: two calls over different ranges are two halves of one index.
	 */
	ocrIndex: new ReducedValue(
		z.custom<OcrIndex | null>().default(() => null),
		{
			inputSchema: z.custom<OcrIndex>(),
			reducer: mergeOcrIndex
		}
	)
});

/**
 * Union of two passes over the same document.
 *
 * Tables are keyed by path, which is derived from page and table id, so a
 * range read twice contributes its tables once. Confidence is averaged over
 * the pages each pass actually read rather than over the two figures, so a
 * one-page second look does not carry the same weight as a forty-page first
 * one.
 */
export function mergeOcrIndex(current: OcrIndex | null, update: OcrIndex): OcrIndex {
	if (!current) return update;

	const tables = new Map(current.tables.map((table) => [table.path, table]));
	for (const table of update.tables) tables.set(table.path, table);

	const weigh = (index: OcrIndex) =>
		index.averageConfidence === null ? 0 : Math.max(index.pagesProcessed, 1);
	const [a, b] = [weigh(current), weigh(update)];

	return {
		model: update.model || current.model,
		pageCount: Math.max(current.pageCount, update.pageCount),
		pagesProcessed: Math.max(current.pagesProcessed, update.pagesProcessed),
		tables: [...tables.values()].sort(
			(x, y) => x.pageIndex - y.pageIndex || x.path.localeCompare(y.path)
		),
		pagesWithoutTables: [...new Set([...current.pagesWithoutTables, ...update.pagesWithoutTables])]
			// A page that produced a table on the second look is no longer a page
			// without one.
			.filter((page) => ![...tables.values()].some((table) => table.pageIndex === page))
			.sort((x, y) => x - y),
		averageConfidence:
			a + b === 0
				? (update.averageConfidence ?? current.averageConfidence)
				: ((current.averageConfidence ?? 0) * a + (update.averageConfidence ?? 0) * b) / (a + b)
	};
}

/** Not persisted — supplied fresh on every invocation. */
export const rowbotContextSchema = z.object({
	documentId: z.string(),
	runId: z.string(),
	userId: z.string(),
	/** Original filename, so the agent can name the workbook sensibly. */
	filename: z.string(),
	mimeType: z.string()
});

export type RowbotContext = z.infer<typeof rowbotContextSchema>;
