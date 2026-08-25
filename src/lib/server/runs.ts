/**
 * Run bookkeeping: creating threads, persisting workbook revisions, and the
 * ownership checks every route needs before it touches a document.
 */
import { error } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document, run, workbook } from '$lib/server/db/schema';
import type { WorkbookModel } from '$lib/types/workbook';
import { asEffort, asModelId, type Effort, type ModelId } from '$lib/server/agent/models';

/**
 * Fetches a document only if it belongs to this user.
 *
 * Throws a 404 rather than a 403 when it belongs to someone else: confirming
 * that an id exists is itself a small leak, and the caller has no business
 * knowing either way.
 */
export async function ownedDocument(documentId: string, userId: string) {
	const [row] = await db
		.select()
		.from(document)
		.where(and(eq(document.id, documentId), eq(document.userId, userId)))
		.limit(1);
	if (!row) error(404, 'That document does not exist.');
	return row;
}

export async function latestRun(documentId: string) {
	const [row] = await db
		.select()
		.from(run)
		.where(eq(run.documentId, documentId))
		.orderBy(desc(run.createdAt))
		.limit(1);
	return row ?? null;
}

export async function ensureRun(
	documentId: string,
	userId: string,
	model: ModelId,
	effort: Effort
) {
	const existing = await latestRun(documentId);
	if (existing) {
		// Switching model or effort mid-conversation is allowed; the thread and
		// all of its accumulated state carry over.
		if (existing.model !== model || existing.effort !== effort) {
			await db.update(run).set({ model, effort }).where(eq(run.id, existing.id));
			return { ...existing, model, effort };
		}
		return existing;
	}

	const [created] = await db
		.insert(run)
		.values({
			documentId,
			userId,
			threadId: crypto.randomUUID(),
			model,
			effort,
			status: 'idle'
		})
		.returning();
	return created;
}

export async function setRunStatus(
	runId: string,
	status: string,
	extra: { errorMessage?: string | null } = {}
) {
	await db
		.update(run)
		.set({ status, errorMessage: extra.errorMessage ?? null })
		.where(eq(run.id, runId));
}

export async function addUsage(
	runId: string,
	usage: { input: number; output: number; reasoning: number }
) {
	await db
		.update(run)
		.set({
			inputTokens: usage.input,
			outputTokens: usage.output,
			reasoningTokens: usage.reasoning
		})
		.where(eq(run.id, runId));
}

export async function latestWorkbook(documentId: string) {
	const [row] = await db
		.select()
		.from(workbook)
		.where(eq(workbook.documentId, documentId))
		.orderBy(desc(workbook.version))
		.limit(1);
	return row ?? null;
}

/** Appends a workbook revision. Versions are per document and monotonic. */
export async function saveWorkbook(
	documentId: string,
	runId: string | null,
	model: WorkbookModel,
	summary?: string
) {
	const previous = await latestWorkbook(documentId);
	const [saved] = await db
		.insert(workbook)
		.values({
			documentId,
			runId,
			version: (previous?.version ?? 0) + 1,
			dataJson: model,
			summary: summary ?? null
		})
		.returning();
	return saved;
}

export async function workbookHistory(documentId: string) {
	return db
		.select({
			id: workbook.id,
			version: workbook.version,
			summary: workbook.summary,
			createdAt: workbook.createdAt
		})
		.from(workbook)
		.where(eq(workbook.documentId, documentId))
		.orderBy(desc(workbook.version))
		.limit(50);
}

export function resolveModelPreferences(source: {
	defaultModel?: string | null;
	defaultEffort?: string | null;
}) {
	return {
		model: asModelId(source.defaultModel),
		effort: asEffort(source.defaultEffort)
	};
}
