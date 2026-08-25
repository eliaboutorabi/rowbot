import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import { blob, index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { user } from './auth.schema';

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

/** A source file the user uploaded: a PDF or an image containing tables. */
export const document = sqliteTable(
	'document',
	{
		id: id(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** Human-facing name, defaults to the original filename. */
		name: text('name').notNull(),
		originalFilename: text('original_filename').notNull(),
		mimeType: text('mime_type').notNull(),
		sizeBytes: integer('size_bytes').notNull(),
		/** Vercel Blob URL, or a `local:` URL when running without a blob store. */
		blobUrl: text('blob_url'),
		blobPathname: text('blob_pathname'),
		pageCount: integer('page_count'),
		/** pending | ocr | ready | failed */
		status: text('status').notNull().default('pending'),
		errorMessage: text('error_message'),
		/** Model used by Mistral for the last OCR pass. */
		ocrModel: text('ocr_model'),
		ocrPagesProcessed: integer('ocr_pages_processed'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(now)
			.$onUpdate(() => new Date())
	},
	(t) => [index('document_user_idx').on(t.userId, t.createdAt)]
);

/** One OCR'd page of a document. Images count as a single page 0. */
export const documentPage = sqliteTable(
	'document_page',
	{
		id: id(),
		documentId: text('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'cascade' }),
		pageIndex: integer('page_index').notNull(),
		markdown: text('markdown').notNull().default(''),
		header: text('header'),
		footer: text('footer'),
		width: integer('width'),
		height: integer('height'),
		dpi: integer('dpi'),
		avgConfidence: real('avg_confidence'),
		minConfidence: real('min_confidence'),
		/** OCRTableObject[] as returned by Mistral, serialised. */
		tablesJson: text('tables_json', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
		/** Paragraph-level blocks with bounding boxes, for the source overlay. */
		blocksJson: text('blocks_json', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(t) => [index('document_page_doc_idx').on(t.documentId, t.pageIndex)]
);

/** An agent conversation against a document. Maps 1:1 to a LangGraph thread. */
export const run = sqliteTable(
	'run',
	{
		id: id(),
		documentId: text('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** LangGraph thread_id — the key into the checkpoint tables. */
		threadId: text('thread_id').notNull().unique(),
		title: text('title'),
		model: text('model').notNull(),
		effort: text('effort').notNull(),
		/** idle | running | interrupted | done | failed | cancelled */
		status: text('status').notNull().default('idle'),
		errorMessage: text('error_message'),
		/**
		 * Agent turns taken on this run. The free allowance is metered in turns
		 * rather than runs: one document with an unbounded conversation costs
		 * exactly as much as unbounded documents.
		 */
		turns: integer('turns').notNull().default(0),
		inputTokens: integer('input_tokens').notNull().default(0),
		outputTokens: integer('output_tokens').notNull().default(0),
		reasoningTokens: integer('reasoning_tokens').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(now)
			.$onUpdate(() => new Date())
	},
	(t) => [index('run_document_idx').on(t.documentId, t.createdAt)]
);

/**
 * A versioned snapshot of the workbook the agent has built. Every
 * `write_sheet` / `edit_cells` commit produces a new version so the UI can
 * diff, and so an interrupted run never loses accepted work.
 */
export const workbook = sqliteTable(
	'workbook',
	{
		id: id(),
		documentId: text('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'cascade' }),
		runId: text('run_id').references(() => run.id, { onDelete: 'set null' }),
		version: integer('version').notNull(),
		/** WorkbookModel — see $lib/types/workbook.ts */
		dataJson: text('data_json', { mode: 'json' }).$type<unknown>().notNull(),
		/** What changed in this version, for the history rail. */
		summary: text('summary'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(t) => [index('workbook_document_idx').on(t.documentId, t.version)]
);

/**
 * A user's own provider API keys, encrypted at rest.
 *
 * Supplying both keys is what lifts the free allowance: from that point the
 * account spends its own credit, so there is nothing left to ration. The
 * columns hold ciphertext produced by `$lib/server/secrets`; the `*Hint`
 * columns hold a masked fragment that is safe to render.
 */
export const userCredential = sqliteTable('user_credential', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	openaiKey: text('openai_key'),
	openaiHint: text('openai_hint'),
	mistralKey: text('mistral_key'),
	mistralHint: text('mistral_hint'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(now)
		.$onUpdate(() => new Date())
});

/* ------------------------------------------------------------------ */
/* LangGraph persistence                                               */
/* ------------------------------------------------------------------ */

/**
 * LangGraph checkpoints. Backing store for the custom `LibSqlSaver`, which is
 * what makes a run resumable across serverless invocations — essential on
 * Vercel where a single request is capped well below a long extraction.
 */
export const checkpoint = sqliteTable(
	'checkpoint',
	{
		threadId: text('thread_id').notNull(),
		checkpointNs: text('checkpoint_ns').notNull().default(''),
		checkpointId: text('checkpoint_id').notNull(),
		parentCheckpointId: text('parent_checkpoint_id'),
		type: text('type'),
		checkpoint: blob('checkpoint', { mode: 'buffer' }).notNull(),
		metadata: blob('metadata', { mode: 'buffer' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(t) => [
		primaryKey({ columns: [t.threadId, t.checkpointNs, t.checkpointId] }),
		index('checkpoint_thread_idx').on(t.threadId, t.checkpointNs, t.checkpointId)
	]
);

/** Pending channel writes attached to a checkpoint. */
export const checkpointWrite = sqliteTable(
	'checkpoint_write',
	{
		threadId: text('thread_id').notNull(),
		checkpointNs: text('checkpoint_ns').notNull().default(''),
		checkpointId: text('checkpoint_id').notNull(),
		taskId: text('task_id').notNull(),
		idx: integer('idx').notNull(),
		channel: text('channel').notNull(),
		type: text('type'),
		value: blob('value', { mode: 'buffer' }),
		taskPath: text('task_path').notNull().default('')
	},
	(t) => [
		primaryKey({
			columns: [t.threadId, t.checkpointNs, t.checkpointId, t.taskId, t.idx]
		})
	]
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const documentRelations = relations(document, ({ one, many }) => ({
	user: one(user, { fields: [document.userId], references: [user.id] }),
	pages: many(documentPage),
	runs: many(run),
	workbooks: many(workbook)
}));

export const documentPageRelations = relations(documentPage, ({ one }) => ({
	document: one(document, { fields: [documentPage.documentId], references: [document.id] })
}));

export const runRelations = relations(run, ({ one, many }) => ({
	document: one(document, { fields: [run.documentId], references: [document.id] }),
	user: one(user, { fields: [run.userId], references: [user.id] }),
	workbooks: many(workbook)
}));

export const workbookRelations = relations(workbook, ({ one }) => ({
	document: one(document, { fields: [workbook.documentId], references: [document.id] }),
	run: one(run, { fields: [workbook.runId], references: [run.id] })
}));

export type Document = typeof document.$inferSelect;
export type UserCredential = typeof userCredential.$inferSelect;
export type DocumentPage = typeof documentPage.$inferSelect;
export type Run = typeof run.$inferSelect;
export type Workbook = typeof workbook.$inferSelect;

export * from './auth.schema';
