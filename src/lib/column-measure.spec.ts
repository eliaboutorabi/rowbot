import { describe, expect, it } from 'vitest';
import { measureColumns } from './column-measure';
import type { Cell, Sheet } from '$lib/types/workbook';

/** No canvas in this environment, so widths fall back to a per-character estimate. */
const FONT = { font: '13px sans-serif', headerFont: '600 13px sans-serif' };

const cell = (v: string | number | null): Cell => ({
	v,
	t: v === null ? 'blank' : typeof v === 'number' ? 'number' : 'text'
});

function sheet(rows: (string | number | null)[][], headerRows = 1): Sheet {
	return {
		id: 's',
		name: 'Transcript',
		headerRows,
		columns: rows[0].map(() => ({})),
		rows: rows.map((row) => row.map(cell))
	};
}

describe('measureColumns', () => {
	it('does not let a long header set a numeric column’s floor', () => {
		// The transcript: two-character grades under a header naming a semester.
		// Sizing the column to the header is most of what pushed twelve columns
		// off the side of the screen, and the header can be clipped — its text
		// is a hover away. The grades cannot.
		const grades = sheet([
			['Second semester 1388–89 final grade'],
			...Array.from({ length: 20 }, () => [16.5])
		]);

		const [column] = measureColumns(grades, FONT);

		expect(column.demand).toBeGreaterThan(column.min);
		expect(column.min).toBeLessThan(120);
	});

	it('keeps a numeric column wide enough for its widest figure', () => {
		const money = sheet([['Revenue'], [1000], [23401316], [500]]);

		const [column] = measureColumns(money, FONT);
		const eight = '23401316'.length * 7.2;

		expect(column.min).toBeGreaterThanOrEqual(eight);
	});

	it('lets a text column shrink well below what it asks for', () => {
		const titles = sheet([
			['Course Title'],
			...Array.from({ length: 20 }, () => ['Principles of Governmental Budgeting Regulation'])
		]);

		const [column] = measureColumns(titles, FONT);

		expect(column.min).toBeLessThan(column.demand);
		expect(column.min).toBeLessThanOrEqual(84);
	});

	it('ignores one long cell when sizing a text column', () => {
		const notes = sheet([
			['Note'],
			...Array.from({ length: 19 }, () => ['ok']),
			['a footnote that ran on for a very long time indeed and then some more']
		]);

		const [column] = measureColumns(notes, FONT);

		expect(column.demand).toBeLessThan(200);
	});

	it('sizes a column with no body rows from its header alone', () => {
		const empty = sheet([['Status'], [null], [null]]);

		const [column] = measureColumns(empty, FONT);

		expect(column.demand).toBeGreaterThan(0);
		expect(column.min).toBeGreaterThan(0);
	});
});
