import { describe, expect, it } from 'vitest';
import { blockOf, blockToTsv, blockSize, selectionToTsv } from './grid-clipboard';
import { parseRef } from './sheet-ref';
import type { Cell, Sheet } from './types/workbook';

const t = (v: string): Cell => ({ v, t: 'text' });
const n = (v: number): Cell => ({ v, t: 'number' });
const money = (v: number): Cell => ({ v, t: 'currency', fmt: '"$"#,##0' });

const sheet: Sheet = {
	id: 's1',
	name: 'Ledger',
	headerRows: 1,
	columns: [{ label: 'Region' }, { label: 'Units' }, { label: 'Revenue', fmt: '"$"#,##0' }],
	rows: [
		[t('Region'), t('Units'), t('Revenue')],
		[t('North America'), n(110589), money(6467886)],
		[t('EMEA'), n(119972), money(6550071)],
		[t('APAC'), n(113877), money(6032019)]
	]
};

const ref = (raw: string) => parseRef(raw)!;

describe('blockOf', () => {
	it('resolves a whole row against the sheet it belongs to', () => {
		expect(blockOf(sheet, ref('Ledger!2:2'))).toEqual({
			firstRow: 1,
			lastRow: 1,
			firstColumn: 0,
			lastColumn: 2
		});
	});

	it('resolves a whole column, header row included', () => {
		expect(blockOf(sheet, ref('Ledger!B:B'))).toEqual({
			firstRow: 0,
			lastRow: 3,
			firstColumn: 1,
			lastColumn: 1
		});
	});

	it('clamps a reference that runs past the end of the sheet', () => {
		expect(blockOf(sheet, ref('Ledger!A1:Z99'))).toEqual({
			firstRow: 0,
			lastRow: 3,
			firstColumn: 0,
			lastColumn: 2
		});
	});
});

describe('blockToTsv', () => {
	it('writes the values the grid shows, not the raw numbers', () => {
		const tsv = blockToTsv(sheet, blockOf(sheet, ref('Ledger!C2:C3')));
		expect(tsv).toBe('$6,467,886\n$6,550,071');
	});

	it('separates columns with tabs and rows with newlines', () => {
		const tsv = blockToTsv(sheet, blockOf(sheet, ref('Ledger!A2:B3')));
		expect(tsv).toBe('North America\t110,589\nEMEA\t119,972');
	});

	it('leaves a covered cell empty rather than repeating its anchor', () => {
		const merged: Sheet = {
			...sheet,
			rows: [
				[{ ...t('Spans two'), merge: { rs: 1, cs: 2 } }, { ...t(''), covered: true }, t('C')],
				...sheet.rows.slice(1)
			]
		};
		expect(blockToTsv(merged, blockOf(merged, ref('Ledger!A1:C1')))).toBe('Spans two\t\tC');
	});

	it('collapses a tab or newline inside a cell, which would break the paste', () => {
		const messy: Sheet = { ...sheet, rows: [[t('one\ttwo\nthree')], ...sheet.rows.slice(1)] };
		expect(blockToTsv(messy, { firstRow: 0, lastRow: 0, firstColumn: 0, lastColumn: 0 })).toBe(
			'one two three'
		);
	});
});

describe('selectionToTsv', () => {
	it('prefers the range when one has been built', () => {
		expect(selectionToTsv(sheet, ref('Ledger!A2:A3'), { row: 3, column: 0 })).toBe(
			'North America\nEMEA'
		);
	});

	it('falls back to the single cell under the cursor', () => {
		expect(selectionToTsv(sheet, null, { row: 1, column: 1 })).toBe('110,589');
	});

	it('returns null with nothing selected, so the keystroke can fall through', () => {
		expect(selectionToTsv(sheet, null, null)).toBeNull();
	});
});

describe('blockSize', () => {
	it('counts a rectangle', () => {
		expect(blockSize(sheet, ref('Ledger!A2:C3'))).toBe(6);
	});

	it('counts a bare cursor as one', () => {
		expect(blockSize(sheet, null)).toBe(1);
	});
});
