import { describe, expect, it } from 'vitest';
import { allocateWidths, representative, type ColumnDemand } from './column-layout';

const total = (values: number[]) => values.reduce((a, b) => a + b, 0);
const col = (demand: number, min = 80, max = 400): ColumnDemand => ({ demand, min, max });

describe('representative', () => {
	it('ignores the one long cell that would set the whole column', () => {
		// Nineteen short course codes and one footnote that ran on.
		const widths = [...Array(19).fill(60), 900];
		expect(representative(widths)).toBe(60);
	});

	it('keeps the widest value when the spread is genuine', () => {
		const widths = [60, 70, 80, 90, 100, 110, 120, 130];
		expect(representative(widths)).toBe(130);
	});

	it('trusts every value when there are too few to call one an outlier', () => {
		expect(representative([40, 900])).toBe(900);
	});

	it('handles a column where every cell is the same width', () => {
		expect(representative(Array(30).fill(72))).toBe(72);
	});

	it('has nothing to say about an empty column', () => {
		expect(representative([])).toBe(0);
	});
});

describe('allocateWidths', () => {
	it('grows columns into spare room rather than leaving a ragged edge', () => {
		const widths = allocateWidths([col(100), col(100), col(100)], 600);
		expect(total(widths)).toBe(600);
		expect(widths).toEqual([200, 200, 200]);
	});

	it('never grows a column past its ceiling, even with room going spare', () => {
		const widths = allocateWidths([col(100, 80, 150), col(100, 80, 150)], 1000);
		expect(widths).toEqual([150, 150]);
	});

	it('shrinks a wide sheet to fit instead of scrolling', () => {
		// Seven columns that wanted 1100px, in a 780px pane, with room above
		// their floors to give it back.
		const columns = Array.from({ length: 7 }, () => col(157, 76));
		const widths = allocateWidths(columns, 780);

		expect(total(widths)).toBe(780);
		expect(Math.min(...widths)).toBeGreaterThanOrEqual(76);
	});

	it('shrinks as far as it can when it cannot fit, rather than not at all', () => {
		// The transcript: twelve columns wanting 1320px in a 780px pane. They
		// will not fit — but 912 of sideways scrolling is not 1320 of it.
		const columns = Array.from({ length: 12 }, () => col(110, 76));
		const widths = allocateWidths(columns, 780);

		expect(total(widths)).toBe(12 * 76);
		expect(total(widths)).toBeLessThan(12 * 110);
	});

	it('takes the squeeze out of the text columns and leaves the numbers alone', () => {
		// A numeric column's minimum is its demand: a clipped number is a
		// different number, so the text column beside it gives up the room.
		const money = { demand: 120, min: 120, max: 120 };
		const title = col(300, 80);

		const [moneyWidth, titleWidth] = allocateWidths([money, title], 300);

		expect(moneyWidth).toBe(120);
		expect(titleWidth).toBe(180);
	});

	it('stops at the minimums and lets the sheet scroll when it truly cannot fit', () => {
		const columns = Array.from({ length: 10 }, () => col(200, 90));
		const widths = allocateWidths(columns, 300);

		expect(widths.every((width) => width === 90)).toBe(true);
		expect(total(widths)).toBe(900);
	});

	it('respects a minimum that is wider than the ceiling it was given', () => {
		expect(allocateWidths([{ demand: 50, min: 200, max: 100 }], 50)).toEqual([200]);
	});

	it('has nothing to allocate for a sheet with no columns', () => {
		expect(allocateWidths([], 800)).toEqual([]);
	});
});
