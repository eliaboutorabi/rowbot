/**
 * Bringing every formula in a workbook back into line with the cells under it.
 *
 * A formula cell carries both the expression and the number it last worked out
 * to, because the grid, the exporter and any reader that will not recalculate
 * all need a value to show. That cached number is correct until somebody
 * changes a cell the formula depends on — and then the workbook is showing a
 * total that contradicts its own column, which is the exact failure this whole
 * application exists to catch. Correcting a misread figure by hand must not
 * create one.
 *
 * Everything is re-evaluated rather than only what depends on the edit. There
 * is no dependency graph to consult, the formulas here are a handful of SUMs
 * over a column, and a sheet small enough to fit in a browser is small enough
 * to walk.
 */
import { evaluateFormula } from './formula';
import type { WorkbookModel } from './types/workbook';

/**
 * A formula reading another formula's result needs that one settled first, and
 * nothing here knows the order. Repeating until nothing moves gets there, and
 * the cap stops a circular reference spinning: whatever it has after three
 * passes is what it keeps, which is no worse than the stale value it started
 * with.
 */
const PASSES = 3;

export interface Recalculated {
	workbook: WorkbookModel;
	/** How many cached results actually moved. */
	changed: number;
}

export function recalculate(input: WorkbookModel): Recalculated {
	const workbook = structuredClone(input);
	let changed = 0;

	for (let pass = 0; pass < PASSES; pass++) {
		let moved = 0;
		const sheets = workbook.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows }));

		for (const sheet of workbook.sheets) {
			for (const row of sheet.rows) {
				for (const cell of row) {
					if (!cell?.f) continue;

					const result = evaluateFormula(cell.f, { sheets, current: sheet.name });
					// A formula that no longer evaluates keeps the number it had. The
					// alternative is blanking a figure because a range went out of
					// range, which loses information and tells the reader nothing.
					if (!result.ok || result.value === cell.v) continue;

					cell.v = result.value;
					moved++;
				}
			}
		}

		changed += moved;
		if (!moved) break;
	}

	return { workbook, changed };
}
