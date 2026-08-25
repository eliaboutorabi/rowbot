/**
 * A reviewer's own edit to a cell.
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
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { latestWorkbook, ownedDocument, saveWorkbook } from '$lib/server/runs';
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
