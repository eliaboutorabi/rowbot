/**
 * `set_formula` — write a live formula into a cell, with its value.
 *
 * Before this, a formula could only reach a cell through `edit_cells`, which
 * runs its input through the value coercer — and the coercer has no concept of
 * a formula, so `=SUM('Ledger'!B2:B7)` landed as *text*. A summary sheet built
 * that way is a column of strings: not a number in the grid, not a number in
 * the exported file, and no amount of recalculating fixes it because there is
 * nothing there to recalculate.
 *
 * The split is the same one `check_totals` makes. The model decides what the
 * formula should be — which cells a summary draws on is a judgement about the
 * document — and the arithmetic is done here, so the value in the cell is one
 * this code computed rather than one the model asserted.
 */
import { tool, type ToolRuntime } from '@langchain/core/tools';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';
import { evaluateFormula } from '$lib/formula';
import { cellRef, type Cell, type CellType, type WorkbookModel } from '$lib/types/workbook';
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

const NUMERIC: CellType[] = ['number', 'currency', 'percent'];

const schema = z.object({
	sheet: z.string().describe('Sheet the formulas are written into.'),
	formulas: z
		.array(
			z.object({
				row: z.number().int().min(0).describe('Zero-based row, counting header rows.'),
				column: z.number().int().min(0).describe('Zero-based column.'),
				formula: z
					.string()
					.describe(
						"The formula, with or without a leading `=`. Supports SUM, AVERAGE, COUNT, MIN, MAX, ROUND, ABS, arithmetic and brackets, over cells and ranges on any sheet: `SUM(B2:B7)`, `'Global Sales Ledger'!D131`, `SUM(Q1!C2:C40) + SUM(Q2!C2:C40)`. Quote a sheet name that contains a space."
					),
				type: z
					.enum(['number', 'currency', 'percent'])
					.optional()
					.describe('How to format the result. Defaults to whatever the column already uses.'),
				note: z.string().optional().describe('Comment attached to the cell in Excel.')
			})
		)
		.min(1)
		.max(200)
});

export const setFormulaTool = tool(
	async ({ sheet: sheetName, formulas }, runtime: ToolRuntime<RowbotState, RowbotContext>) => {
		const workbook = currentWorkbook(runtime.state);
		const wanted = sheetName.trim().toLowerCase();
		const sheet = workbook.sheets.find(
			(candidate) => candidate.name.toLowerCase() === wanted || candidate.id === sheetName
		);
		if (!sheet) {
			return `No sheet called “${sheetName}”. Sheets: ${workbook.sheets.map((s) => s.name).join(', ')}`;
		}

		const context = {
			sheets: workbook.sheets.map((s) => ({ name: s.name, rows: s.rows })),
			current: sheet.name
		};

		const edits: Array<{ row: number; column: number; cell: Cell }> = [];
		const wrote: string[] = [];
		const failed: string[] = [];

		for (const { row, column, formula, type, note } of formulas) {
			const ref = cellRef(row, column);
			const target = sheet.rows[row]?.[column];
			if (!target) {
				failed.push(`${ref} is outside the sheet`);
				continue;
			}

			const result = evaluateFormula(formula, context);
			if (!result.ok) {
				failed.push(`${ref} — ${result.error}`);
				continue;
			}

			// Borrow the column's format when none is given, so a computed total
			// looks like the money it is totalling.
			const inherited =
				target.fmt ??
				sheet.rows.find((r, i) => i !== row && r[column]?.fmt)?.[column]?.fmt ??
				sheet.columns[column]?.fmt;

			const resolvedType: CellType =
				type ??
				(NUMERIC.includes(target.t) ? target.t : (sheet.rows[row + 1]?.[column]?.t ?? 'number'));

			edits.push({
				row,
				column,
				cell: {
					...target,
					t: NUMERIC.includes(resolvedType) ? resolvedType : 'number',
					v: result.value,
					f: formula.replace(/^=/, ''),
					fmt: inherited,
					...(note ? { note } : {}),
					check: { status: 'ok', message: `Computed as =${formula.replace(/^=/, '')}.` }
				}
			});
			wrote.push(`${ref} = ${result.value}`);
		}

		if (!edits.length) {
			return ['No formula could be written.', ...failed.map((line) => `- ${line}`)].join('\n');
		}

		emitProgress(runtime)({
			kind: 'cells:edited',
			sheet: sheet.name,
			count: edits.length
		});

		const ops: WorkbookOp[] = [{ op: 'editCells', id: sheet.id, edits }];
		const lines = [
			`Wrote ${edits.length} formula${edits.length === 1 ? '' : 's'} into “${sheet.name}”.`,
			`\nEvaluated:\n${wrote.map((l) => `- ${l}`).join('\n')}`,
			failed.length
				? `\nNOT WRITTEN (${failed.length}):\n${failed.map((l) => `- ${l}`).join('\n')}\n\nFix the reference or the function and try again — a cell is better left alone than filled with a number nobody computed.`
				: ''
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
		name: 'set_formula',
		description:
			'Write live Excel formulas into cells and compute their values. Use this for anything a cell should calculate rather than state — a summary sheet drawing figures from other sheets, a derived column, a grand total across sheets. The formula goes into the .xlsx as a real formula and the computed result is stored with it, so the number shows everywhere without a recalculation. Never write a formula through `edit_cells`: that stores it as text.',
		schema
	}
);
