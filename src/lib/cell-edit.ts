/**
 * Turning what a reviewer typed into a cell.
 *
 * Shared by the edit endpoint and its tests, and kept away from the route so
 * the interesting part — what a string becomes, and what survives from the
 * cell it replaces — can be checked without a database or a session.
 */
import { toCell } from './coerce';
import { evaluateFormula } from './formula';
import type { Cell, WorkbookModel } from './types/workbook';

export function applyCellEdit(
	value: string,
	previous: Cell,
	model: WorkbookModel,
	sheetName: string
): Cell {
	const next = value.trim().startsWith('=')
		? formulaCell(value, model, sheetName, previous)
		: plainCell(value, previous);

	return {
		...next,
		// What the page said survives a correction — it is the whole basis for
		// the inspector being able to say "the page said 8,200".
		raw: previous.raw ?? (previous.v == null ? undefined : String(previous.v)),
		merge: previous.merge,
		covered: previous.covered
	};
}

/** A typed value, taking its format from the cell it replaces. */
function plainCell(value: string, previous: Cell): Cell {
	const next = toCell(value);
	return { ...next, fmt: next.fmt ?? previous.fmt };
}

/**
 * A formula the reviewer typed, evaluated for the same reason the agent's are:
 * the grid has no calculation engine, and a formula with no value shows as
 * blank. One that will not evaluate is kept as text with the reason attached
 * rather than rejected, so the reviewer can see what they typed and fix it.
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
