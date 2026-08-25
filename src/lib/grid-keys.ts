/**
 * Where a keystroke moves the selection in a sheet.
 *
 * Split out from the grid component because this is the part with the edge
 * cases — clamping at four boundaries, the meta-key jumps, the page size — and
 * none of it needs a DOM to be checked. The component keeps the parts that do:
 * measuring the viewport, scrolling the target into view, painting.
 *
 * Indices are zero-based throughout, matching `Sheet.rows`.
 */
import { formatRef, type SheetRef } from './sheet-ref';

export interface Cursor {
	row: number;
	column: number;
}

export interface Bounds {
	/** Inclusive. */
	lastRow: number;
	/** Inclusive. */
	lastColumn: number;
}

export interface Chord {
	key: string;
	/** Cmd on a Mac, Ctrl elsewhere — either one means "jump to the edge". */
	jump?: boolean;
}

/**
 * The cell a keystroke targets, already clamped, or `null` if the key is not
 * one this grid handles — which the caller must treat as "do not intercept".
 */
export function nextCell(
	chord: Chord,
	here: Cursor,
	bounds: Bounds,
	pageRows: number
): Cursor | null {
	const { key, jump } = chord;
	let to: Cursor;

	switch (key) {
		case 'ArrowUp':
			to = { row: jump ? 0 : here.row - 1, column: here.column };
			break;
		case 'ArrowDown':
			to = { row: jump ? bounds.lastRow : here.row + 1, column: here.column };
			break;
		case 'ArrowLeft':
			to = { row: here.row, column: jump ? 0 : here.column - 1 };
			break;
		case 'ArrowRight':
			to = { row: here.row, column: jump ? bounds.lastColumn : here.column + 1 };
			break;
		case 'Home':
			to = jump ? { row: 0, column: 0 } : { row: here.row, column: 0 };
			break;
		case 'End':
			to = jump
				? { row: bounds.lastRow, column: bounds.lastColumn }
				: { row: here.row, column: bounds.lastColumn };
			break;
		case 'PageUp':
			to = { row: here.row - pageRows, column: here.column };
			break;
		case 'PageDown':
			to = { row: here.row + pageRows, column: here.column };
			break;
		default:
			return null;
	}

	return {
		row: Math.min(Math.max(to.row, 0), Math.max(bounds.lastRow, 0)),
		column: Math.min(Math.max(to.column, 0), Math.max(bounds.lastColumn, 0))
	};
}

/**
 * The rectangle between two cells, as a reference the rest of the app already
 * understands — the same shape a click on a gutter number produces, so a
 * shift-extended selection can be attached to a message like any other.
 *
 * Returns `null` when the two ends are the same cell: a single cell is what
 * `selected` already says, and a one-cell "range" would draw a highlight
 * around the cursor for no reason.
 */
export function spanBetween(anchor: Cursor, to: Cursor, sheet: string): SheetRef | null {
	if (anchor.row === to.row && anchor.column === to.column) return null;
	const shape = {
		kind: 'range' as const,
		from: { row: Math.min(anchor.row, to.row), column: Math.min(anchor.column, to.column) },
		to: { row: Math.max(anchor.row, to.row), column: Math.max(anchor.column, to.column) }
	};
	return { sheet, ...shape, raw: formatRef(sheet, shape) };
}
