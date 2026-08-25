import { describe, expect, it } from 'vitest';
import { columnIndex, columnName, contains, formatRef, parseRef, refLabel } from './sheet-ref';

describe('column letters', () => {
	it('round-trips past Z', () => {
		for (const index of [0, 1, 25, 26, 27, 51, 52, 701, 702]) {
			expect(columnIndex(columnName(index))).toBe(index);
		}
		expect(columnName(0)).toBe('A');
		expect(columnName(26)).toBe('AA');
	});

	it('rejects anything that is not letters', () => {
		expect(columnIndex('A1')).toBeNull();
		expect(columnIndex('')).toBeNull();
	});
});

describe('parsing references the agent writes', () => {
	it('reads a single cell', () => {
		const ref = parseRef('Revenue!B3')!;
		expect(ref.kind).toBe('cell');
		expect(ref.from).toEqual({ row: 2, column: 1 });
		expect(ref.to).toEqual({ row: 2, column: 1 });
	});

	it('reads a rectangle and normalises a backwards one', () => {
		const forward = parseRef('Revenue!B3:D8')!;
		const backward = parseRef('Revenue!D8:B3')!;
		expect(forward.from).toEqual({ row: 2, column: 1 });
		expect(forward.to).toEqual({ row: 7, column: 3 });
		expect(backward.from).toEqual(forward.from);
		expect(backward.to).toEqual(forward.to);
	});

	it('reads whole rows and columns', () => {
		const row = parseRef('Ledger!5:5')!;
		expect(row.kind).toBe('row');
		expect(row.from).toEqual({ row: 4, column: -1 });

		const column = parseRef('Ledger!C:C')!;
		expect(column.kind).toBe('column');
		expect(column.from).toEqual({ row: -1, column: 2 });
	});

	it('handles sheet names with spaces, quoted or not', () => {
		expect(parseRef("'Revenue by Region'!A1")?.sheet).toBe('Revenue by Region');
		expect(parseRef('Revenue by Region!A1')?.sheet).toBe('Revenue by Region');
	});

	it('returns null instead of throwing on anything malformed', () => {
		// This runs over model output; a bad reference must render as plain text
		// rather than take the message down with it.
		for (const bad of ['', 'no-bang', 'Sheet!', '!A1', 'Sheet!ZZ', 'Sheet!0', 'Sheet!A0']) {
			expect(parseRef(bad)).toBeNull();
		}
	});
});

describe('formatting', () => {
	it('quotes a sheet name only when it needs it', () => {
		const cell = { kind: 'cell' as const, from: { row: 2, column: 1 }, to: { row: 2, column: 1 } };
		expect(formatRef('Revenue', cell)).toBe('Revenue!B3');
		expect(formatRef('Revenue by Region', cell)).toBe("'Revenue by Region'!B3");
	});

	it('round-trips through parse', () => {
		for (const raw of ['S!B3', 'S!B3:D8', 'S!5:5', 'S!C:C']) {
			const ref = parseRef(raw)!;
			expect(formatRef(ref.sheet, ref)).toBe(raw);
		}
	});

	it('labels ranges the way a person would say them', () => {
		expect(refLabel(parseRef('S!B3')!)).toBe('B3');
		expect(refLabel(parseRef('S!5:5')!)).toBe('row 5');
		expect(refLabel(parseRef('S!5:8')!)).toBe('rows 5–8');
		expect(refLabel(parseRef('S!C:C')!)).toBe('column C');
	});
});

describe('containment', () => {
	it('treats a whole row or column as unbounded on the other axis', () => {
		const row = parseRef('S!5:5')!;
		expect(contains(row, 4, 0)).toBe(true);
		expect(contains(row, 4, 999)).toBe(true);
		expect(contains(row, 5, 0)).toBe(false);

		const column = parseRef('S!C:C')!;
		expect(contains(column, 0, 2)).toBe(true);
		expect(contains(column, 999, 2)).toBe(true);
		expect(contains(column, 0, 3)).toBe(false);
	});

	it('bounds a rectangle on both axes', () => {
		const range = parseRef('S!B3:D8')!;
		expect(contains(range, 2, 1)).toBe(true);
		expect(contains(range, 7, 3)).toBe(true);
		expect(contains(range, 1, 1)).toBe(false);
		expect(contains(range, 2, 4)).toBe(false);
	});
});
