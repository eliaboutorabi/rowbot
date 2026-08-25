/**
 * Workbook mutations as data.
 *
 * The agent routinely imports several tables in a single step — the model
 * issues the tool calls in parallel — so a channel that simply overwrites the
 * workbook loses all but one of them. Instead each tool emits *operations*,
 * and a reducer folds them onto the current workbook in order. Concurrent
 * calls compose, and the op log doubles as the revision history the UI shows.
 */
import {
	normalizeSheet,
	safeSheetName,
	type Cell,
	type Sheet,
	type WorkbookModel
} from '$lib/types/workbook';

export type WorkbookOp =
	| { op: 'addSheet'; sheet: Sheet }
	| { op: 'updateSheet'; id: string; patch: Partial<Omit<Sheet, 'id'>> }
	| { op: 'editCells'; id: string; edits: Array<{ row: number; column: number; cell: Cell }> }
	| { op: 'removeSheet'; id: string }
	| { op: 'setMeta'; title?: string; notes?: string; order?: string[] };

export function emptyModel(title = 'Untitled'): WorkbookModel {
	return { title, sheets: [] };
}

function withSheet(
	wb: WorkbookModel,
	id: string,
	map: (sheet: Sheet) => Sheet | null
): WorkbookModel {
	let touched = false;
	const sheets: Sheet[] = [];
	for (const sheet of wb.sheets) {
		if (sheet.id !== id) {
			sheets.push(sheet);
			continue;
		}
		touched = true;
		const next = map(sheet);
		if (next) sheets.push(next);
	}
	return touched ? { ...wb, sheets } : wb;
}

export function applyOp(wb: WorkbookModel, op: WorkbookOp): WorkbookModel {
	switch (op.op) {
		case 'addSheet': {
			// Names are re-resolved here rather than in the tool: two parallel
			// imports both saw the same pre-step workbook and can pick the same
			// name, and Excel refuses a file with duplicate sheet names.
			const taken = wb.sheets.map((s) => s.name);
			const sheet = normalizeSheet({ ...op.sheet, name: safeSheetName(op.sheet.name, taken) });
			return { ...wb, sheets: [...wb.sheets, sheet] };
		}

		case 'updateSheet':
			return withSheet(wb, op.id, (sheet) => {
				const merged = { ...sheet, ...op.patch, id: sheet.id };
				if (op.patch.name) {
					const others = wb.sheets.filter((s) => s.id !== op.id).map((s) => s.name);
					merged.name = safeSheetName(op.patch.name, others);
				}
				return normalizeSheet(merged);
			});

		case 'editCells':
			return withSheet(wb, op.id, (sheet) => {
				const rows = sheet.rows.map((row) => [...row]);
				for (const { row, column, cell } of op.edits) {
					if (row < 0 || row >= rows.length) continue;
					if (column < 0 || column >= (rows[row]?.length ?? 0)) continue;
					rows[row][column] = cell;
				}
				return normalizeSheet({ ...sheet, rows });
			});

		case 'removeSheet':
			return withSheet(wb, op.id, () => null);

		case 'setMeta': {
			let sheets = wb.sheets;
			if (op.order?.length) {
				const wanted = op.order.map((n) => n.toLowerCase());
				const ranked = wanted
					.map((n) => sheets.find((s) => s.name.toLowerCase() === n))
					.filter((s): s is Sheet => Boolean(s));
				const rest = sheets.filter((s) => !ranked.includes(s));
				sheets = [...ranked, ...rest];
			}
			return {
				...wb,
				title: op.title ?? wb.title,
				notes: op.notes ?? wb.notes,
				sheets
			};
		}

		default:
			return wb;
	}
}

/**
 * The channel update type.
 *
 * Normally a list of operations. A whole `WorkbookModel` is also accepted so
 * a thread can be seeded with an existing workbook — resuming a run, or
 * handing one to a subagent — where there is no op history to replay.
 */
export type WorkbookUpdate = readonly WorkbookOp[] | WorkbookModel;

function isModel(update: WorkbookUpdate): update is WorkbookModel {
	return !Array.isArray(update) && Array.isArray((update as WorkbookModel)?.sheets);
}

export function applyOps(wb: WorkbookModel, update: WorkbookUpdate): WorkbookModel {
	if (update == null) return wb;
	if (isModel(update)) return update;
	if (!Array.isArray(update)) return wb;
	return update.reduce(applyOp, wb);
}

/** One-line description of an op, for the revision rail in the UI. */
export function describeOp(op: WorkbookOp, wb: WorkbookModel): string {
	const nameOf = (id: string) => wb.sheets.find((s) => s.id === id)?.name ?? 'a sheet';
	switch (op.op) {
		case 'addSheet':
			return `Added “${op.sheet.name}”`;
		case 'updateSheet':
			return op.patch.name ? `Renamed to “${op.patch.name}”` : `Updated “${nameOf(op.id)}”`;
		case 'editCells':
			return `Corrected ${op.edits.length} cell${op.edits.length === 1 ? '' : 's'} in “${nameOf(op.id)}”`;
		case 'removeSheet':
			return `Removed “${nameOf(op.id)}”`;
		case 'setMeta':
			return op.title ? `Titled the workbook “${op.title}”` : 'Reordered the sheets';
	}
}
