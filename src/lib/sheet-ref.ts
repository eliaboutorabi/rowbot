/**
 * A1 references, shared by the agent's prose and the reviewer's selection.
 *
 * Both directions of the conversation need the same vocabulary. When the agent
 * writes "the total in [[Revenue!F7]] does not reconcile", that has to become
 * something clickable; when you select a column and add it to the chat, that
 * has to become something the agent can act on. Excel's own notation is the
 * obvious choice — the model already knows it, and so does anyone who has used
 * a spreadsheet.
 *
 *   Sheet!B3        a cell
 *   Sheet!B3:D8     a rectangle
 *   Sheet!5:5       a whole row
 *   Sheet!C:C       a whole column
 *
 * Row and column numbers here are zero-based indices into `Sheet.rows`, while
 * the notation is one-based as Excel writes it. The conversion happens only at
 * these boundaries.
 */

export type RefKind = 'cell' | 'range' | 'row' | 'column';

export interface SheetRef {
	sheet: string;
	kind: RefKind;
	/** Inclusive, zero-based. `-1` means "the whole axis". */
	from: { row: number; column: number };
	to: { row: number; column: number };
	/** The reference exactly as written, for round-tripping. */
	raw: string;
}

/** `0 → A`, `26 → AA`. */
export function columnName(index: number): string {
	let name = '';
	let n = index;
	while (n >= 0) {
		name = String.fromCharCode(65 + (n % 26)) + name;
		n = Math.floor(n / 26) - 1;
	}
	return name;
}

/** `A → 0`, `AA → 26`. Returns `null` for anything that is not column letters. */
export function columnIndex(letters: string): number | null {
	if (!/^[A-Za-z]+$/.test(letters)) return null;
	let index = 0;
	for (const character of letters.toUpperCase()) {
		index = index * 26 + (character.charCodeAt(0) - 64);
	}
	return index - 1;
}

const CELL = /^([A-Za-z]+)(\d+)$/;
const ROW_SPAN = /^(\d+):(\d+)$/;
const COLUMN_SPAN = /^([A-Za-z]+):([A-Za-z]+)$/;

/**
 * Parses `Sheet!B3`, `Sheet!B3:D8`, `Sheet!5:5` or `Sheet!C:C`.
 *
 * Returns `null` rather than throwing: this runs over model output, and a
 * malformed reference should render as plain text, not break the message.
 */
export function parseRef(input: string): SheetRef | null {
	const raw = input.trim();
	const split = raw.lastIndexOf('!');
	if (split <= 0 || split === raw.length - 1) return null;

	// Excel quotes sheet names containing spaces; accept them with or without.
	const sheet = raw.slice(0, split).trim().replace(/^'|'$/g, '');
	const target = raw.slice(split + 1).trim();
	if (!sheet) return null;

	const rows = ROW_SPAN.exec(target);
	if (rows) {
		const a = Number(rows[1]) - 1;
		const b = Number(rows[2]) - 1;
		if (a < 0 || b < 0) return null;
		return {
			sheet,
			kind: 'row',
			from: { row: Math.min(a, b), column: -1 },
			to: { row: Math.max(a, b), column: -1 },
			raw
		};
	}

	const columns = COLUMN_SPAN.exec(target);
	if (columns) {
		const a = columnIndex(columns[1]);
		const b = columnIndex(columns[2]);
		if (a === null || b === null) return null;
		return {
			sheet,
			kind: 'column',
			from: { row: -1, column: Math.min(a, b) },
			to: { row: -1, column: Math.max(a, b) },
			raw
		};
	}

	const [start, end] = target.split(':');
	const first = CELL.exec(start ?? '');
	if (!first) return null;
	const firstColumn = columnIndex(first[1]);
	if (firstColumn === null) return null;
	const from = { row: Number(first[2]) - 1, column: firstColumn };
	if (from.row < 0) return null;

	if (end === undefined) {
		return { sheet, kind: 'cell', from, to: { ...from }, raw };
	}

	const second = CELL.exec(end);
	if (!second) return null;
	const secondColumn = columnIndex(second[1]);
	if (secondColumn === null) return null;
	const to = { row: Number(second[2]) - 1, column: secondColumn };
	if (to.row < 0) return null;

	return {
		sheet,
		kind: 'range',
		from: { row: Math.min(from.row, to.row), column: Math.min(from.column, to.column) },
		to: { row: Math.max(from.row, to.row), column: Math.max(from.column, to.column) },
		raw
	};
}

/** The A1 notation for a reference, without the sheet name. */
export function formatTarget(ref: Omit<SheetRef, 'raw' | 'sheet'>): string {
	switch (ref.kind) {
		case 'row':
			return ref.from.row === ref.to.row
				? `${ref.from.row + 1}:${ref.from.row + 1}`
				: `${ref.from.row + 1}:${ref.to.row + 1}`;
		case 'column':
			return ref.from.column === ref.to.column
				? `${columnName(ref.from.column)}:${columnName(ref.from.column)}`
				: `${columnName(ref.from.column)}:${columnName(ref.to.column)}`;
		case 'cell':
			return `${columnName(ref.from.column)}${ref.from.row + 1}`;
		default:
			return `${columnName(ref.from.column)}${ref.from.row + 1}:${columnName(ref.to.column)}${ref.to.row + 1}`;
	}
}

/** Full `Sheet!A1` notation, quoting the sheet name only when it needs it. */
export function formatRef(sheet: string, ref: Omit<SheetRef, 'raw' | 'sheet'>): string {
	const name = /[\s!]/.test(sheet) ? `'${sheet}'` : sheet;
	return `${name}!${formatTarget(ref)}`;
}

/** Short human label for a chip: `B3`, `B3:D8`, `row 5`, `column C`. */
export function refLabel(ref: SheetRef): string {
	switch (ref.kind) {
		case 'row':
			return ref.from.row === ref.to.row
				? `row ${ref.from.row + 1}`
				: `rows ${ref.from.row + 1}–${ref.to.row + 1}`;
		case 'column':
			return ref.from.column === ref.to.column
				? `column ${columnName(ref.from.column)}`
				: `columns ${columnName(ref.from.column)}–${columnName(ref.to.column)}`;
		default:
			return formatTarget(ref);
	}
}

/** Whether a cell falls inside a reference, treating `-1` as the whole axis. */
export function contains(ref: SheetRef, row: number, column: number): boolean {
	const rowOk = ref.from.row === -1 || (row >= ref.from.row && row <= ref.to.row);
	const columnOk = ref.from.column === -1 || (column >= ref.from.column && column <= ref.to.column);
	return rowOk && columnOk;
}
