/**
 * Turning a selection into something you can paste.
 *
 * Tab-separated, because that is what Excel, Numbers and Sheets all read off
 * the clipboard without asking any questions — paste a block copied here into
 * a spreadsheet and it lands as cells, not as one long string. CSV would need
 * quoting rules and would still paste into a single column in some of them.
 *
 * The values are the ones on screen, not the raw model: if the grid shows
 * `$6,467,886` because the column carries a currency format, that is the
 * number the reader means when they select it. A tab or newline inside a cell
 * would break the grid the paste lands in, so both collapse to a space.
 */
import { formatCell } from './cell-format';
import type { SheetRef } from './sheet-ref';
import type { Sheet } from './types/workbook';

/** What a selection resolves to: a rectangle of row and column indices. */
export interface Block {
	firstRow: number;
	lastRow: number;
	firstColumn: number;
	lastColumn: number;
}

/**
 * The concrete rectangle a reference covers in this sheet.
 *
 * A whole-row or whole-column reference stores `-1` for its open axis; a
 * clipboard needs both ends, and the sheet is what supplies them. Header rows
 * are included: copying a column and losing its heading is the kind of helpful
 * that costs you five minutes at the other end.
 */
export function blockOf(sheet: Sheet, ref: SheetRef): Block {
	const lastRow = Math.max(sheet.rows.length - 1, 0);
	const lastColumn = Math.max(sheet.columns.length - 1, 0);
	return {
		firstRow: ref.from.row === -1 ? 0 : Math.min(ref.from.row, lastRow),
		lastRow: ref.to.row === -1 ? lastRow : Math.min(ref.to.row, lastRow),
		firstColumn: ref.from.column === -1 ? 0 : Math.min(ref.from.column, lastColumn),
		lastColumn: ref.to.column === -1 ? lastColumn : Math.min(ref.to.column, lastColumn)
	};
}

/** One cell as the grid shows it, safe to sit between tabs. */
function text(sheet: Sheet, row: number, column: number): string {
	const cell = sheet.rows[row]?.[column];
	if (!cell) return '';
	return formatCell(cell, sheet.columns[column]?.fmt).replace(/[\t\r\n]+/g, ' ');
}

/**
 * A block of the sheet as tab-separated rows.
 *
 * Cells hidden under a merge contribute an empty column rather than repeating
 * their anchor's value, which is what a spreadsheet does with a merged range
 * and keeps the paste the same shape as what was selected.
 */
export function blockToTsv(sheet: Sheet, block: Block): string {
	const lines: string[] = [];
	for (let r = block.firstRow; r <= block.lastRow; r++) {
		const cells: string[] = [];
		for (let c = block.firstColumn; c <= block.lastColumn; c++) {
			cells.push(sheet.rows[r]?.[c]?.covered ? '' : text(sheet, r, c));
		}
		lines.push(cells.join('\t'));
	}
	return lines.join('\n');
}

/**
 * What Cmd-C should put on the clipboard, given whatever is selected.
 *
 * A range wins over the cursor: if you built a block with shift-arrow, that
 * block is the selection. With no range, the single cell under the cursor is.
 * Returns `null` when there is nothing selected, so the caller can let the
 * keystroke fall through to the browser's own copy.
 */
export function selectionToTsv(
	sheet: Sheet,
	range: SheetRef | null,
	selected: { row: number; column: number } | null
): string | null {
	if (range) return blockToTsv(sheet, blockOf(sheet, range));
	if (selected) return text(sheet, selected.row, selected.column);
	return null;
}

/** How many cells a copy covered, for the confirmation. */
export function blockSize(sheet: Sheet, range: SheetRef | null): number {
	if (!range) return 1;
	const b = blockOf(sheet, range);
	return (b.lastRow - b.firstRow + 1) * (b.lastColumn - b.firstColumn + 1);
}
