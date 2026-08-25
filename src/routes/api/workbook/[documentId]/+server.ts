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
import { toCell } from '$lib/coerce';
import { evaluateFormula } from '$lib/formula';
import { cellRef, type Cell, type WorkbookModel } from '$lib/types/workbook';

const body = z.object({
	sheetId: z.string(),
	row: z.number().int().min(0),
	column: z.number().int().min(0),
	/** The text as typed. A leading `=` makes it a formula. Empty clears the cell. */
	value: z.string()
});

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

	const typed = value.trim().startsWith('=')
		? formulaCell(value, model, sheet.name, previous)
		: plainCell(value, previous);

	sheet.rows[row][column] = {
		...typed,
		// What the page said survives a correction — it is the whole basis for
		// the inspector being able to say "the page said 8,200".
		raw: previous.raw ?? (previous.v == null ? undefined : String(previous.v)),
		merge: previous.merge,
		covered: previous.covered
	};

	const ref = `${sheet.name}!${cellRef(row, column)}`;
	await saveWorkbook(doc.id, saved.runId, model, `You edited ${ref}`);

	return json({ workbook: model, ref });
};

/** A typed value, taking its format from the cell it replaces. */
function plainCell(value: string, previous: Cell): Cell {
	const next = toCell(value);
	return { ...next, fmt: next.fmt ?? previous.fmt };
}

/**
 * A formula the reviewer typed, evaluated here for the same reason the agent's
 * are: the grid has no calculation engine, and a formula with no value shows
 * as blank. One that will not evaluate is kept as text rather than rejected —
 * the reviewer can see what they typed and fix it.
 */
function formulaCell(value: string, model: WorkbookModel, current: string, previous: Cell): Cell {
	const source = value.trim().replace(/^=/, '');
	const result = evaluateFormula(source, {
		sheets: model.sheets.map((s) => ({ name: s.name, rows: s.rows })),
		current
	});

	if (!result.ok) {
		return { v: value.trim(), t: 'text', note: `That formula did not evaluate: ${result.error}` };
	}

	return {
		v: result.value,
		t: previous.t === 'currency' || previous.t === 'percent' ? previous.t : 'number',
		f: source,
		fmt: previous.fmt,
		check: { status: 'ok', message: `Computed as =${source}.` }
	};
}
