/**
 * The tools the agent uses to build the workbook.
 *
 * The split of labour matters: parsing HTML into a grid and typing values are
 * deterministic, so they happen in code where they are testable and free. The
 * agent decides the things that genuinely need judgement — which tables belong
 * together, what a sheet should be called, where the header really ends, which
 * misread cells to correct, and what the reviewer needs warning about.
 *
 * Every mutation is emitted as a `WorkbookOp` so that several tool calls made
 * in the same step compose instead of overwriting one another.
 */
import { tool, type ToolRuntime } from '@langchain/core/tools';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';
import { toCell } from '$lib/coerce';
import { headerLabels, parseTableHtml } from '$lib/server/ocr/html-table';
import {
	blankCell,
	normalizeSheet,
	type Cell,
	type CellType,
	type Sheet,
	type WorkbookModel
} from '$lib/types/workbook';
import type { RowbotContext } from '../state';
import { emptyModel, type WorkbookOp } from '../workbook-ops';
import { emitProgress } from '../events';

const CELL_TYPES = [
	'text',
	'number',
	'currency',
	'percent',
	'date',
	'boolean',
	'formula',
	'blank'
] as const;

interface RowbotState {
	workbook: WorkbookModel;
	files?: Record<string, { content: string | Uint8Array } | undefined>;
}

function currentWorkbook(state: unknown): WorkbookModel {
	const wb = (state as RowbotState | undefined)?.workbook;
	return wb && Array.isArray(wb.sheets) ? wb : emptyModel();
}

function readFile(state: unknown, path: string): string | null {
	const entry = (state as RowbotState | undefined)?.files?.[path];
	if (!entry) return null;
	const { content } = entry;
	return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

function findSheet(wb: WorkbookModel, name: string): Sheet | undefined {
	const lower = name.toLowerCase().trim();
	return wb.sheets.find((s) => s.name.toLowerCase() === lower || s.id === name);
}

function sheetList(wb: WorkbookModel): string {
	return wb.sheets.map((s) => `"${s.name}"`).join(', ') || '(none yet)';
}

/** Applies an explicit column type over whatever coercion guessed. */
function retype(cell: Cell, type: CellType | undefined): Cell {
	if (!type || cell.t === type || cell.t === 'blank') return cell;
	const text = cell.raw ?? (cell.v == null ? '' : String(cell.v));
	if (type === 'text') return { ...cell, v: text, t: 'text', fmt: undefined };
	const recoerced = toCell(text);
	return recoerced.t === type ? { ...cell, ...recoerced } : cell;
}

function sheetSummary(sheet: Sheet): string {
	const body = Math.max(sheet.rows.length - sheet.headerRows, 0);
	return `"${sheet.name}" — ${sheet.rows.length} rows (${sheet.headerRows} header, ${body} data) × ${sheet.columns.length} columns`;
}

/** Wraps ops plus the tool's reply into the single update LangGraph expects. */
function commit(runtime: { toolCallId: string }, ops: WorkbookOp[], content: string) {
	return new Command({
		update: {
			workbook: ops,
			messages: [{ role: 'tool', tool_call_id: runtime.toolCallId, content }]
		}
	});
}

/* ------------------------------------------------------------------ */
/* import_table                                                        */
/* ------------------------------------------------------------------ */

export const importTableTool = tool(
	async (
		{ path, name, headerRows, dropRows, notes },
		runtime: ToolRuntime<RowbotState, RowbotContext>
	) => {
		const html = readFile(runtime.state, path);
		if (!html) {
			return `No file at ${path}. Use \`ls\` to see what OCR produced, or run \`ocr_document\` first.`;
		}

		const parsed = parseTableHtml(html);
		if (!parsed.rows.length) return `${path} did not contain a readable table.`;

		const resolvedHeaderRows = headerRows ?? parsed.headerRows;

		let rows = parsed.rows;
		if (dropRows?.length) {
			const drop = new Set(dropRows);
			rows = rows.filter((_, i) => !drop.has(i));
		}

		const labels = headerLabels(rows, resolvedHeaderRows, parsed.width);
		const pageMatch = /page-(\d+)-/.exec(path);

		const sheet = normalizeSheet({
			id: crypto.randomUUID(),
			name,
			rows,
			columns: labels.map((label) => ({ label: label || undefined })),
			headerRows: resolvedHeaderRows,
			freeze: resolvedHeaderRows > 0 ? { rows: resolvedHeaderRows, cols: 0 } : undefined,
			source: pageMatch ? { pageIndex: Number(pageMatch[1]) - 1 } : undefined,
			notes
		});

		emitProgress(runtime)({
			kind: 'sheet:written',
			name: sheet.name,
			rows: sheet.rows.length,
			columns: sheet.columns.length
		});

		return commit(
			runtime,
			[{ op: 'addSheet', sheet }],
			[
				`Added ${sheetSummary(sheet)}.`,
				`Columns: ${labels.map((l, i) => l || `(col ${i + 1})`).join(' | ')}`,
				'Verify the values with `read_sheet` before you move on.'
			].join('\n')
		);
	},
	{
		name: 'import_table',
		description:
			'Turn one OCR table file (from /source/tables/) into a new sheet. Merged cells, thousands separators, percentages, currencies and accounting negatives are all handled for you.',
		schema: z.object({
			path: z.string().describe('Path to the table HTML, e.g. /source/tables/page-1-tbl-0.html'),
			name: z.string().describe('Sheet name. Short and descriptive; 31 characters max.'),
			headerRows: z
				.number()
				.int()
				.min(0)
				.max(10)
				.optional()
				.describe('Override the detected number of header rows.'),
			dropRows: z
				.array(z.number().int().min(0))
				.optional()
				.describe('Zero-based row indices to discard, e.g. a repeated header or a footnote row.'),
			notes: z.string().optional().describe('What the reviewer should know about this sheet.')
		})
	}
);

/* ------------------------------------------------------------------ */
/* read_sheet                                                          */
/* ------------------------------------------------------------------ */

export const readSheetTool = tool(
	async ({ name, startRow, maxRows }, runtime: ToolRuntime<RowbotState, RowbotContext>) => {
		const wb = currentWorkbook(runtime.state);

		if (!name) {
			if (!wb.sheets.length) return 'The workbook is empty.';
			return [
				`Workbook "${wb.title}" — ${wb.sheets.length} sheet(s):`,
				...wb.sheets.map((s, i) => `${i + 1}. ${sheetSummary(s)}`)
			].join('\n');
		}

		const sheet = findSheet(wb, name);
		if (!sheet) return `No sheet called "${name}". Sheets: ${sheetList(wb)}`;

		const from = startRow ?? 0;
		const to = Math.min(from + (maxRows ?? 40), sheet.rows.length);

		const lines = [sheetSummary(sheet), ''];
		for (let r = from; r < to; r++) {
			const cells = sheet.rows[r].map((cell) => {
				if (cell.covered) return '↑';
				if (cell.t === 'blank') return '';
				const shown =
					cell.t === 'percent' ? `${(Number(cell.v) * 100).toFixed(2)}%` : String(cell.v);
				return cell.raw && cell.raw !== shown ? `${shown} «${cell.raw}»` : shown;
			});
			lines.push(`r${r}: ${cells.join(' | ')}`);
		}
		if (to < sheet.rows.length) lines.push(`… ${sheet.rows.length - to} more rows`);
		lines.push(
			'',
			`Column types: ${sheet.rows[sheet.headerRows]?.map((c) => c.t).join(' | ') ?? '(no data rows)'}`
		);

		return lines.join('\n');
	},
	{
		name: 'read_sheet',
		description:
			'Inspect the workbook. Omit `name` to list every sheet; pass one to page through its rows. Values in «guillemets» show the original OCR text where it differs from the typed value.',
		schema: z.object({
			name: z.string().optional().describe('Sheet name. Omit to list all sheets.'),
			startRow: z.number().int().min(0).optional(),
			maxRows: z.number().int().min(1).max(200).optional()
		})
	}
);

/* ------------------------------------------------------------------ */
/* edit_cells                                                          */
/* ------------------------------------------------------------------ */

export const editCellsTool = tool(
	async ({ sheet: sheetName, edits }, runtime: ToolRuntime<RowbotState, RowbotContext>) => {
		const wb = currentWorkbook(runtime.state);
		const sheet = findSheet(wb, sheetName);
		if (!sheet) return `No sheet called "${sheetName}". Sheets: ${sheetList(wb)}`;

		const applied: Array<{ row: number; column: number; cell: Cell }> = [];
		const problems: string[] = [];

		for (const edit of edits) {
			const { row, column } = edit;
			if (row >= sheet.rows.length || column >= sheet.columns.length) {
				problems.push(`r${row}c${column} is outside the sheet`);
				continue;
			}
			const previous = sheet.rows[row][column];
			const base: Cell = edit.value === null ? blankCell() : toCell(String(edit.value));
			const typed = edit.type ? retype(base, edit.type as CellType) : base;

			applied.push({
				row,
				column,
				cell: {
					...typed,
					...(edit.note ? { note: edit.note } : {}),
					// Keep what the page actually said, even after a correction.
					raw: previous.raw ?? (previous.v == null ? undefined : String(previous.v)),
					merge: previous.merge,
					covered: previous.covered
				}
			});
		}

		emitProgress(runtime)({
			kind: 'cells:edited',
			sheet: sheet.name,
			count: applied.length
		});

		return commit(
			runtime,
			applied.length ? [{ op: 'editCells', id: sheet.id, edits: applied }] : [],
			[
				`Applied ${applied.length} edit(s) to "${sheet.name}".`,
				...problems.map((p) => `Skipped: ${p}`)
			].join('\n')
		);
	},
	{
		name: 'edit_cells',
		description:
			'Correct individual cells — an OCR misread, a number that should be text, a footnote marker to strip. The original page text is kept as provenance.',
		schema: z.object({
			sheet: z.string(),
			edits: z
				.array(
					z.object({
						row: z.number().int().min(0).describe('Zero-based row, counting header rows.'),
						column: z.number().int().min(0).describe('Zero-based column.'),
						value: z
							.union([z.string(), z.number(), z.boolean(), z.null()])
							.describe('New value. Pass null to clear the cell.'),
						type: z.enum(CELL_TYPES).optional().describe('Force a specific cell type.'),
						note: z.string().optional().describe('Comment attached to the cell in Excel.')
					})
				)
				.min(1)
				.max(200)
		})
	}
);

/* ------------------------------------------------------------------ */
/* update_sheet                                                        */
/* ------------------------------------------------------------------ */

export const updateSheetTool = tool(
	async (
		{ sheet: sheetName, rename, headerRows, columns: columnPatches, notes, remove },
		runtime: ToolRuntime<RowbotState, RowbotContext>
	) => {
		const wb = currentWorkbook(runtime.state);
		const sheet = findSheet(wb, sheetName);
		if (!sheet) return `No sheet called "${sheetName}". Sheets: ${sheetList(wb)}`;

		if (remove) {
			emitProgress(runtime)({ kind: 'sheet:removed', name: sheet.name });
			return commit(
				runtime,
				[{ op: 'removeSheet', id: sheet.id }],
				`Removed sheet "${sheet.name}".`
			);
		}

		const patch: Partial<Omit<Sheet, 'id'>> = {};
		if (rename) patch.name = rename;
		if (notes !== undefined) patch.notes = notes;

		let rows = sheet.rows;
		let columns = sheet.columns;
		const resolvedHeaderRows = headerRows ?? sheet.headerRows;

		if (headerRows !== undefined) {
			patch.headerRows = headerRows;
			patch.freeze =
				headerRows > 0 ? { rows: headerRows, cols: sheet.freeze?.cols ?? 0 } : undefined;
			columns = headerLabels(rows, headerRows, columns.length).map((label, i) => ({
				...columns[i],
				label: label || undefined
			}));
			patch.columns = columns;
		}

		if (columnPatches?.length) {
			const byIndex = new Map(columnPatches.map((c) => [c.column, c]));

			columns = columns.map((col, i) => {
				const change = byIndex.get(i);
				if (!change) return col;
				return {
					...col,
					...(change.type ? { type: change.type as CellType } : {}),
					...(change.format !== undefined ? { fmt: change.format } : {}),
					...(change.label !== undefined ? { label: change.label } : {})
				};
			});

			rows = rows.map((row, r) => {
				if (r < resolvedHeaderRows) return row;
				return row.map((cell, c) => {
					const change = byIndex.get(c);
					if (!change) return cell;
					const typed = retype(cell, change.type as CellType | undefined);
					// A column format has to clear the per-cell format inherited from
					// the page, or the cell's own pattern keeps winning.
					return change.format !== undefined ? { ...typed, fmt: undefined } : typed;
				});
			});

			patch.columns = columns;
			patch.rows = rows;
		}

		const preview = normalizeSheet({ ...sheet, ...patch });
		emitProgress(runtime)({
			kind: 'sheet:written',
			name: preview.name,
			rows: preview.rows.length,
			columns: preview.columns.length
		});

		return commit(
			runtime,
			[{ op: 'updateSheet', id: sheet.id, patch }],
			`Updated ${sheetSummary(preview)}.`
		);
	},
	{
		name: 'update_sheet',
		description:
			'Rename a sheet, change where the header ends, retype or reformat columns, relabel headers, attach reviewer notes, or delete the sheet entirely.',
		schema: z.object({
			sheet: z.string(),
			rename: z.string().optional(),
			headerRows: z.number().int().min(0).max(10).optional(),
			columns: z
				.array(
					z.object({
						column: z.number().int().min(0).describe('Zero-based column index.'),
						type: z.enum(CELL_TYPES).optional(),
						format: z
							.string()
							.optional()
							.describe(
								[
									'Excel number format applied to the whole column, overriding the',
									'per-cell format detected from the page. Examples: `#,##0.00` for two',
									'decimals, `0.00%` for a percentage with two decimals, `yyyy-mm-dd`',
									'for a date, `[$$-en-US]#,##0.00` for US dollars.'
								].join(' ')
							),
						label: z.string().optional().describe('Replacement header label for this column.')
					})
				)
				.optional(),
			notes: z.string().optional(),
			remove: z.boolean().optional().describe('Delete this sheet.')
		})
	}
);

/* ------------------------------------------------------------------ */
/* set_workbook_title                                                  */
/* ------------------------------------------------------------------ */

export const setWorkbookTitleTool = tool(
	async ({ title, notes, order }, runtime: ToolRuntime<RowbotState, RowbotContext>) => {
		const wb = currentWorkbook(runtime.state);
		return commit(
			runtime,
			[{ op: 'setMeta', title, notes, order }],
			`Workbook is now "${title ?? wb.title}"${order?.length ? ` with sheets ordered: ${order.join(', ')}` : ''}.`
		);
	},
	{
		name: 'set_workbook_title',
		description:
			'Name the workbook, reorder its sheets, and record the notes the reviewer should read. Call this last.',
		schema: z.object({
			title: z.string().optional(),
			notes: z
				.string()
				.optional()
				.describe('Caveats and judgement calls the reviewer should check.'),
			order: z.array(z.string()).optional().describe('Sheet names in the order they should appear.')
		})
	}
);

export const workbookTools = [
	importTableTool,
	readSheetTool,
	editCellsTool,
	updateSheetTool,
	setWorkbookTitleTool
];
