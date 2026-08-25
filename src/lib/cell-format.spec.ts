import { describe, expect, it } from 'vitest';
import { formatCell } from './cell-format';
import type { Cell } from '$lib/types/workbook';

const cell = (c: Partial<Cell>): Cell => ({ v: null, t: 'blank', ...c }) as Cell;

describe('formatCell', () => {
	it('renders grouped numbers the way the page showed them', () => {
		expect(formatCell(cell({ v: 12430, t: 'number', fmt: '#,##0' }))).toBe('12,430');
		// A bare year keeps its literal form rather than becoming "2,024".
		expect(formatCell(cell({ v: 2024, t: 'number' }))).toBe('2024');
	});

	it('renders a stored fraction back as the printed percentage', () => {
		expect(formatCell(cell({ v: 0.051, t: 'percent', fmt: '0.0%' }))).toBe('5.1%');
	});

	it('puts the currency symbol outside the minus sign', () => {
		const fmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
		expect(formatCell(cell({ v: -1234, t: 'currency', fmt }))).toBe('-$1,234.00');
		expect(formatCell(cell({ v: 1234, t: 'currency', fmt }))).toBe('$1,234.00');
	});

	it('shows dates in a sortable, unambiguous form', () => {
		expect(formatCell(cell({ v: '2025-01-31', t: 'date' }))).toBe('2025-01-31');
	});

	it('shows nothing at all for an empty cell', () => {
		expect(formatCell(cell({}))).toBe('');
	});
});

describe('column formats', () => {
	it('uses the column format when the cell has none', () => {
		expect(formatCell(cell({ v: 0.051, t: 'percent' }), '0.00%')).toBe('5.10%');
	});

	it('lets an explicit cell format win over the column default', () => {
		expect(formatCell(cell({ v: 0.051, t: 'percent', fmt: '0.0%' }), '0.00%')).toBe('5.1%');
	});
});
