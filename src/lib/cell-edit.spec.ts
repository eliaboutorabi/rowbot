import { describe, expect, it } from 'vitest';
import { applyCellEdit } from './cell-edit';
import type { Cell, WorkbookModel } from './types/workbook';

const n = (v: number, fmt?: string): Cell => ({ v, t: 'number', ...(fmt ? { fmt } : {}) });
const money = (v: number): Cell => ({ v, t: 'currency', fmt: '"$"#,##0' });
const t = (v: string): Cell => ({ v, t: 'text' });

const model = (): WorkbookModel => ({
	title: 'Book',
	sheets: [
		{
			id: 's1',
			name: 'Ledger',
			headerRows: 1,
			columns: [{ label: 'Region' }, { label: 'Units' }],
			rows: [
				[t('Region'), t('Units')],
				[t('North America'), n(10)],
				[t('EMEA'), n(20)]
			]
		}
	]
});

const edit = (value: string, previous: Cell) => applyCellEdit(value, previous, model(), 'Ledger');

describe('applyCellEdit', () => {
	it('types a plain number', () => {
		const cell = edit('8200', n(8100));
		expect(cell.v).toBe(8200);
		expect(cell.t).toBe('number');
		expect(cell.f).toBeUndefined();
	});

	it('keeps what the page said, so the inspector can still show provenance', () => {
		expect(edit('8200', { v: 8100, t: 'number', raw: '8,I00' }).raw).toBe('8,I00');
		// With no prior `raw`, the value being replaced becomes the provenance.
		expect(edit('8200', n(8100)).raw).toBe('8100');
	});

	it('inherits the format of the cell it replaces', () => {
		expect(edit('9000', money(8100)).fmt).toBe('"$"#,##0');
	});

	it('clears a cell when given nothing', () => {
		expect(edit('', n(8100)).t).toBe('blank');
	});

	it('keeps a merge intact', () => {
		const previous: Cell = { ...n(1), merge: { rs: 2, cs: 1 } };
		expect(edit('2', previous).merge).toEqual({ rs: 2, cs: 1 });
	});

	it('evaluates a formula and stores both halves', () => {
		const cell = edit('=SUM(B2:B3)', n(0));
		expect(cell.v).toBe(30);
		expect(cell.f).toBe('SUM(B2:B3)');
		expect(cell.check?.status).toBe('ok');
	});

	it('keeps a currency column currency when a formula lands in it', () => {
		expect(edit('=SUM(B2:B3)', money(0)).t).toBe('currency');
	});

	it('keeps a formula it cannot evaluate as text, with the reason attached', () => {
		const cell = edit('=VLOOKUP(A1, B:B, 2)', n(0));
		expect(cell.t).toBe('text');
		expect(cell.v).toBe('=VLOOKUP(A1, B:B, 2)');
		expect(cell.note).toMatch(/did not evaluate/);
	});

	it('does not mistake text that merely mentions a function for a formula', () => {
		const cell = edit('SUM of all regions', t(''));
		expect(cell.t).toBe('text');
		expect(cell.v).toBe('SUM of all regions');
		expect(cell.note).toBeUndefined();
	});
});
