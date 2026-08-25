/**
 * `check_totals` — verify a total, and make it a real formula.
 *
 * The split matters. The model is good at spotting *which* cell is a total
 * and *what range* it covers; it is not the thing that should be adding up a
 * column of 130 numbers. So the model names the range and this code does the
 * arithmetic, which makes the verification deterministic, free, and auditable.
 *
 * Three outcomes per cell, all useful:
 *   - the printed total matches the column     → verified, and now a formula
 *   - it doesn't                               → flagged for a human, with both numbers
 *   - the range holds nothing numeric          → reported back so the agent can retry
 */
import { tool, type ToolRuntime } from '@langchain/core/tools';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';
import { cellRef, type Cell, type WorkbookModel } from '$lib/types/workbook';
import type { RowbotContext } from '../state';
import { emptyModel, type WorkbookOp } from '../workbook-ops';
import { emitProgress } from '../events';

interface RowbotState {
	workbook: WorkbookModel;
}

function currentWorkbook(state: unknown): WorkbookModel {
	const wb = (state as RowbotState | undefined)?.workbook;
	return wb && Array.isArray(wb.sheets) ? wb : emptyModel();
}

/** Values Excel would include in a SUM: real numbers only. */
const numeric = (cell: Cell | undefined): number | null =>
	cell && typeof cell.v === 'number' && Number.isFinite(cell.v) ? cell.v : null;

/**
 * Money read off a page rarely lands on an exact float. A tenth of a unit, or
 * one part in a million of the total, is rounding; anything more is a misread.
 */
function agrees(sum: number, printed: number): boolean {
	const tolerance = Math.max(0.01, Math.abs(printed) * 1e-6);
	return Math.abs(sum - printed) <= tolerance;
}

const point = z.object({
	row: z.number().int().min(0).describe('Zero-based row index, as `read_sheet` shows them.'),
	column: z.number().int().min(0).describe('Zero-based column index.')
});

const schema = z.object({
	sheet: z.string().describe('Sheet name.'),
	onMismatch: z
		.enum(['keep-printed', 'use-computed'])
		.optional()
		.describe(
			"What to do when a total does not reconcile. Defaults to keep-printed: the cell keeps the document's figure and carries a flag for the reviewer. Pass use-computed only once the reviewer has explicitly said to trust the arithmetic over the page."
		),
	totals: z
		.array(
			z.object({
				cell: point.describe('The cell holding the total.'),
				from: point.describe('First cell of the range being summed.'),
				to: point.describe('Last cell of the range being summed.')
			})
		)
		.min(1)
		.max(64)
		.describe('Every total on the sheet — row totals, column totals, grand totals.')
});

export const checkTotalsTool = tool(
	async (
		{ sheet: sheetName, totals, onMismatch = 'keep-printed' },
		runtime: ToolRuntime<RowbotState, RowbotContext>
	) => {
		const wanted = sheetName.trim().toLowerCase();
		const sheet = currentWorkbook(runtime.state).sheets.find(
			(candidate) => candidate.name.toLowerCase() === wanted || candidate.id === sheetName
		);
		if (!sheet) return `No sheet called “${sheetName}”.`;

		const edits: Array<{ row: number; column: number; cell: Cell }> = [];
		const verified: string[] = [];
		const mismatched: string[] = [];
		const skipped: string[] = [];

		for (const { cell: at, from, to } of totals) {
			const target = sheet.rows[at.row]?.[at.column];
			if (!target) {
				skipped.push(`${cellRef(at.row, at.column)} is outside the sheet`);
				continue;
			}

			const values: number[] = [];
			for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row++) {
				for (
					let column = Math.min(from.column, to.column);
					column <= Math.max(from.column, to.column);
					column++
				) {
					// The total must not be inside its own range.
					if (row === at.row && column === at.column) continue;
					const value = numeric(sheet.rows[row]?.[column]);
					if (value !== null) values.push(value);
				}
			}

			if (!values.length) {
				skipped.push(`${cellRef(at.row, at.column)} — nothing numeric in that range`);
				continue;
			}

			const sum = Number(values.reduce((a, b) => a + b, 0).toFixed(10));
			const range = `${cellRef(from.row, from.column)}:${cellRef(to.row, to.column)}`;
			const printed = numeric(target);
			const ref = cellRef(at.row, at.column);

			// A total should look like the column it totals. A blank or text cell
			// promoted to a number has no format of its own, and a corrected cell
			// may have lost one, so borrow from the values being summed.
			const columnFormat =
				target.fmt ??
				sheet.rows.find((row, index) => index !== at.row && row[at.column]?.fmt)?.[at.column]?.fmt;

			const base: Cell = {
				...target,
				t: target.t === 'blank' || target.t === 'text' ? 'number' : target.t,
				fmt: columnFormat
			};

			let next: Cell;

			if (printed === null) {
				// Nothing to contradict, so the formula simply fills the gap.
				next = { ...base, v: sum, f: `SUM(${range})` };
				next.check = {
					status: 'ok',
					message: `Computed as SUM(${range}); the page left it blank.`
				};
				verified.push(`${ref} filled in from ${range} (${sum})`);
			} else if (agrees(sum, printed)) {
				next = { ...base, v: sum, f: `SUM(${range})` };
				next.check = { status: 'ok', message: `Matches SUM(${range}).` };
				verified.push(`${ref} ✓ ${sum}`);
			} else if (onMismatch === 'use-computed') {
				// Only on an explicit instruction: the reviewer has decided the
				// arithmetic beats the page.
				next = { ...base, v: sum, f: `SUM(${range})`, raw: target.raw ?? String(printed) };
				next.check = {
					status: 'ok',
					message: `The page printed ${printed}; replaced with SUM(${range}) = ${sum} at the reviewer's request.`
				};
				mismatched.push(`${ref} — replaced ${printed} with ${sum}`);
			} else {
				/*
				 * The default, and the case that matters. The cell keeps the number
				 * the document printed: Rowbot does not overwrite a document's own
				 * figure on its own authority, and a workbook that silently
				 * disagrees with its source is worse than one that flags the
				 * disagreement. No formula either — a SUM here would render a value
				 * contradicting the flag sitting on the same cell.
				 */
				next = { ...base, v: printed, raw: target.raw ?? String(printed) };
				next.check = {
					status: 'mismatch',
					message: `The page printed ${printed}, but ${range} adds up to ${sum}.`,
					computed: sum
				};
				mismatched.push(`${ref} — page says ${printed}, ${range} sums to ${sum}`);
			}

			edits.push({ row: at.row, column: at.column, cell: next });
		}

		if (!edits.length) {
			return ['Nothing was checked.', ...skipped.map((line) => `- ${line}`)].join('\n');
		}

		emitProgress(runtime)({
			kind: 'note',
			text: mismatched.length
				? `${mismatched.length} total${mismatched.length === 1 ? '' : 's'} did not reconcile`
				: `${verified.length} total${verified.length === 1 ? '' : 's'} verified`
		});

		const ops: WorkbookOp[] = [{ op: 'editCells', id: sheet.id, edits }];
		const lines = [
			`Checked ${edits.length} total${edits.length === 1 ? '' : 's'} on “${sheet.name}”, and wrote each as a SUM formula.`,
			verified.length
				? `\nReconciled (${verified.length}):\n${verified.map((l) => `- ${l}`).join('\n')}`
				: '',
			mismatched.length
				? `\nDID NOT RECONCILE (${mismatched.length}):\n${mismatched.map((l) => `- ${l}`).join('\n')}\n\nEach keeps the figure the page printed and carries a flag. If you can see which cell was misread, correct it and run this again — the flag clears once the arithmetic agrees. If the page's own total is simply wrong and the reviewer has said to trust the arithmetic, run this again with onMismatch "use-computed".`
				: '',
			skipped.length ? `\nSkipped:\n${skipped.map((l) => `- ${l}`).join('\n')}` : ''
		];

		return new Command({
			update: {
				workbook: ops,
				messages: [
					{
						role: 'tool',
						tool_call_id: runtime.toolCallId,
						content: lines.filter(Boolean).join('\n')
					}
				]
			}
		});
	},
	{
		name: 'check_totals',
		description:
			'Verify every Total / Subtotal / Sum cell on a sheet and turn it into a real Excel SUM formula. You name the total cell and the range it covers; the arithmetic is done here, not by you. Totals that do not reconcile are flagged in the sheet for the reviewer rather than quietly corrected. Run this on any sheet that has a total.',
		schema
	}
);
