import { describe, expect, it } from 'vitest';
import { recalculate } from './recalculate';
import type { Cell, WorkbookModel } from './types/workbook';

const num = (v: number): Cell => ({ v, t: 'number' });
const formula = (f: string, cached: number): Cell => ({ v: cached, t: 'formula', f });

function ledger(gross: number, total: number): WorkbookModel {
	return {
		title: 'Statement',
		sheets: [
			{
				id: 'a',
				name: 'Open Items',
				headerRows: 1,
				columns: [{ label: 'Gross' }],
				rows: [
					[{ v: 'Gross', t: 'text' }],
					[num(100)],
					[num(gross)],
					[formula('SUM(A2:A3)', total)]
				]
			}
		]
	};
}

describe('recalculate', () => {
	it('moves a total that was reading a cell somebody corrected', () => {
		// The reason this exists: a hand-fixed figure must not leave the column
		// total contradicting its own column.
		const { workbook, changed } = recalculate(ledger(2696.52, 2769.52));

		expect(workbook.sheets[0].rows[3][0].v).toBe(2796.52);
		expect(changed).toBe(1);
	});

	it('leaves a total that was already right alone', () => {
		const { changed } = recalculate(ledger(200, 300));
		expect(changed).toBe(0);
	});

	it('settles a formula that reads another formula', () => {
		const model: WorkbookModel = {
			title: 'W',
			sheets: [
				{
					id: 'a',
					name: 'S',
					headerRows: 0,
					columns: [{}, {}],
					rows: [
						[num(10), formula('A1*2', 0)],
						[num(5), formula('B1+A2', 0)]
					]
				}
			]
		};

		const { workbook } = recalculate(model);

		expect(workbook.sheets[0].rows[0][1].v).toBe(20);
		expect(workbook.sheets[0].rows[1][1].v).toBe(25);
	});

	it('keeps the last good number when a formula stops evaluating', () => {
		// Blanking a figure because a range went bad loses information and tells
		// the reader nothing.
		const model = ledger(200, 300);
		model.sheets[0].rows[3][0] = formula('SUM(Nowhere!A1:A9)', 300);

		const { workbook } = recalculate(model);

		expect(workbook.sheets[0].rows[3][0].v).toBe(300);
	});

	it('does not touch the workbook it was given', () => {
		const original = ledger(2696.52, 2769.52);
		recalculate(original);
		expect(original.sheets[0].rows[3][0].v).toBe(2769.52);
	});
});
