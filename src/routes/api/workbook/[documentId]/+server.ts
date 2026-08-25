/**
 * The workbook's history, and a reviewer's own edit to a cell.
 *
 * Everything else in this app changes the workbook by asking the agent to.
 * That is right for anything needing judgement and wrong for the commonest
 * repair of all: you can see the page, you can see the misread digit, and
 * round-tripping that through a language model is slower, costs money, and
 * gives a worse answer than typing it.
 *
 * The edit appends a workbook revision rather than mutating the current one,
 * exactly as an agent turn does, so the history stays a history and the next
 * run picks the change up as its starting state.
 */
import { error, json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { latestWorkbook, ownedDocument, saveWorkbook, workbookHistory } from '$lib/server/runs';
import { db } from '$lib/server/db';
import { workbook } from '$lib/server/db/schema';
import { applyCellEdit } from '$lib/cell-edit';
import { cellRef, type WorkbookModel } from '$lib/types/workbook';

const body = z.object({
	sheetId: z.string(),
	row: z.number().int().min(0),
	column: z.number().int().min(0),
	/** The text as typed. A leading `=` makes it a formula. Empty clears the cell. */
	value: z.string(),
	/**
	 * What the cell held when the editor opened, as the client saw it.
	 *
	 * A compare-and-swap on the one thing that matters. Between the page load
	 * and this request an agent run in another tab may have rewritten the sheet
	 * — and because rows shift, "row 3, column 2" can by then mean a different
	 * figure entirely. Checking the value rather than a revision number needs
	 * no version plumbing and catches exactly the case that would otherwise
	 * write a correction onto the wrong cell in silence.
	 */
	expect: z.string().optional()
});

const asText = (value: unknown) => (value == null ? '' : String(value));

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Sign in first.');

	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'That is not a cell edit.');
	const { sheetId, row, column, value } = parsed.data;

	const doc = await ownedDocument(params.documentId, locals.user.id);
	const saved = await latestWorkbook(doc.id);
	if (!saved) error(404, 'There is no workbook to edit yet.');

	const model = structuredClone(saved.dataJson) as WorkbookModel;
	const sheet = model.sheets.find((candidate) => candidate.id === sheetId);
	if (!sheet) error(404, 'That sheet is not in this workbook.');

	const previous = sheet.rows[row]?.[column];
	if (!previous) error(400, 'That cell is outside the sheet.');

	if (parsed.data.expect !== undefined && asText(previous.v) !== parsed.data.expect) {
		error(
			409,
			'That cell changed while you were editing it. Reload to see what it holds now, then try again.'
		);
	}

	sheet.rows[row][column] = applyCellEdit(value, previous, model, sheet.name);

	const ref = `${sheet.name}!${cellRef(row, column)}`;
	await saveWorkbook(doc.id, saved.runId, model, `You edited ${ref}`);

	return json({ workbook: model, ref });
};

/**
 * Every revision this workbook has had, newest first.
 *
 * Each one was already being written with a sentence saying what changed —
 * the turn that caused it, the cell you corrected, "partial result before an
 * error" — and none of it had ever been shown. A workbook whose whole promise
 * is that you can see how it was arrived at should not keep its own history to
 * itself.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Sign in first.');
	const doc = await ownedDocument(params.documentId, locals.user.id);

	const rows = await workbookHistory(doc.id);
	return json({
		revisions: rows.map((row) => ({
			version: row.version,
			summary: row.summary,
			at: row.createdAt
		}))
	});
};

const restore = z.object({ version: z.number().int().min(1) });

/**
 * Puts the workbook back to how it was at a given revision.
 *
 * By appending, not by rewinding. Restoring is itself a change worth
 * recording, and a history you can lose by using it is not much of a safety
 * net — so the old state becomes the newest revision and everything in
 * between is still there to go back to.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Sign in first.');

	const parsed = restore.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Which revision?');

	const doc = await ownedDocument(params.documentId, locals.user.id);
	const [wanted] = await db
		.select()
		.from(workbook)
		.where(and(eq(workbook.documentId, doc.id), eq(workbook.version, parsed.data.version)))
		.limit(1);

	if (!wanted) error(404, 'That revision is not in this workbook.');

	const current = await latestWorkbook(doc.id);
	if (current?.version === wanted.version) {
		error(409, 'That is already the current version of this workbook.');
	}

	const model = wanted.dataJson as WorkbookModel;
	// Just the version. Echoing the old revision's own summary made the entry
	// twice as long as any other and said nothing the version number did not.
	await saveWorkbook(
		doc.id,
		current?.runId ?? null,
		model,
		`Went back to version ${wanted.version}`
	);

	return json({ workbook: model });
};
