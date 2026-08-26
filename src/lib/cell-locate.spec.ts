import { describe, expect, it } from 'vitest';
import { clusterRows, locateCell, normalise, rowBand, type TextRun } from './cell-locate';

/** The Open Items table on page 2 of the Northwind statement, to scale. */
const TABLE = { x: 58, y: 66, width: 678, height: 573 };

/** Real coordinates, read out of the file with pdf.js. */
const run = (text: string, x: number, y: number, width = 40, height = 10): TextRun => ({
	text,
	x,
	y,
	width,
	height
});

const LEDGER: TextRun[] = [
	run('Line', 58, 68, 20),
	run('Invoice', 109, 68, 36),
	run('Net', 556, 68, 20),
	run('Gross', 693, 68, 28),
	run('001', 58, 109, 20),
	run('SI-4201', 109, 109, 36),
	run('2,269.99', 556, 109),
	run('2,723.99', 693, 109),
	run('002', 58, 130, 20),
	run('SI-4202', 109, 130, 36),
	run('2,267.47', 556, 130),
	run('2,720.96', 693, 130),
	run('003', 58, 150, 20),
	run('SI-4203', 109, 150, 36),
	run('1,057.35', 556, 150),
	run('1,268.82', 693, 150)
];

describe('normalise', () => {
	it('sees past thousands separators and currency', () => {
		expect(normalise('£1,234.50')).toBe('1234.50');
	});

	it('folds Arabic and Persian digits', () => {
		expect(normalise('١٢٣')).toBe('123');
		expect(normalise('۱۲۳')).toBe('123');
	});

	it('folds the Arabic decimal separator', () => {
		expect(normalise('۱۲٫۵')).toBe('12.5');
	});

	it('strips the brackets an accountant writes a negative in', () => {
		expect(normalise('(27.00)')).toBe('27.00');
	});
});

describe('clusterRows', () => {
	it('groups runs onto the lines they were printed on', () => {
		const lines = clusterRows(LEDGER);
		expect(lines).toHaveLength(4);
		expect(lines[0].map((r) => r.text)).toEqual(['Line', 'Invoice', 'Net', 'Gross']);
		expect(lines[2].map((r) => r.text)).toEqual(['002', 'SI-4202', '2,267.47', '2,720.96']);
	});

	it('orders each line left to right whatever order it arrived in', () => {
		const shuffled = [LEDGER[7], LEDGER[4], LEDGER[6], LEDGER[5]];
		expect(clusterRows(shuffled)[0].map((r) => r.text)).toEqual([
			'001',
			'SI-4201',
			'2,269.99',
			'2,723.99'
		]);
	});

	it('has nothing to group on a page with no text layer', () => {
		expect(clusterRows([])).toEqual([]);
	});
});

describe('rowBand', () => {
	it('cuts the table into equal bands', () => {
		const band = rowBand({ x: 0, y: 100, width: 200, height: 400 }, 4, 2);
		expect(band).toEqual({ x: 0, y: 300, width: 200, height: 100 });
	});

	it('clamps a row beyond the end rather than falling off the page', () => {
		expect(rowBand({ x: 0, y: 0, width: 10, height: 100 }, 4, 99).y).toBe(75);
	});
});

describe('locateCell', () => {
	it('finds the exact figure', () => {
		const found = locateCell({ table: TABLE, runs: LEDGER, text: '2269.99', row: 1, rows: 4 });
		expect(found.precision).toBe('cell');
		expect(found.box).toMatchObject({ x: 556, y: 109 });
	});

	it('tells two columns of the same row apart', () => {
		const gross = locateCell({ table: TABLE, runs: LEDGER, text: '2723.99', row: 1, rows: 4 });
		expect(gross.box.x).toBe(693);
	});

	it('tells two rows of the same column apart', () => {
		const third = locateCell({ table: TABLE, runs: LEDGER, text: '1057.35', row: 3, rows: 4 });
		expect(third.box).toMatchObject({ x: 556, y: 150 });
	});

	it('matches the workbook value against the page formatting', () => {
		// The cell holds 2269.99; the page printed "2,269.99".
		expect(locateCell({ table: TABLE, runs: LEDGER, text: '2269.99' }).precision).toBe('cell');
	});

	it('matches a figure the page drew as several runs', () => {
		const split = [run('1', 556, 200, 6), run(',', 562, 200, 3), run('057.35', 565, 200, 30)];
		const found = locateCell({ table: TABLE, runs: split, text: '1057.35' });
		expect(found.precision).toBe('cell');
		expect(found.box).toMatchObject({ x: 556, width: 39 });
	});

	it('picks the repeat on the row it was asked about', () => {
		const repeated: TextRun[] = [
			run('Monthly retainer', 300, 109, 90),
			run('Monthly retainer', 300, 130, 90),
			run('Monthly retainer', 300, 150, 90)
		];
		const second = locateCell({
			table: TABLE,
			runs: repeated,
			text: 'Monthly retainer',
			row: 1,
			rows: 3
		});
		expect(second.box.y).toBe(130);
	});

	it('falls back to the row when the page has no text layer', () => {
		// A scan. Every page of a photographed ledger looks like this.
		const found = locateCell({ table: TABLE, runs: [], text: '2269.99', row: 1, rows: 4 });
		expect(found.precision).toBe('row');
		expect(found.box.height).toBeCloseTo(573 / 4);
		expect(found.box.width).toBe(TABLE.width);
	});

	it('falls back to the table when it does not even know the row', () => {
		expect(locateCell({ table: TABLE, runs: [], text: 'x' })).toEqual({
			box: TABLE,
			precision: 'table'
		});
	});

	it('ignores text outside the table, so a header is not mistaken for a cell', () => {
		const outside = [run('2,269.99', 556, 20)];
		expect(locateCell({ table: TABLE, runs: outside, text: '2269.99' }).precision).toBe('table');
	});

	it('says table rather than guess when the cell is empty', () => {
		expect(locateCell({ table: TABLE, runs: LEDGER, text: '' }).precision).toBe('table');
	});
});
