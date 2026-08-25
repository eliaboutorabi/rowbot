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
	ocrIndex: z.custom<OcrIndex | null>().default(() => null)
});

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
