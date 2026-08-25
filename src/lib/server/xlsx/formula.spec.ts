import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbook } from './build';
import type { Cell, WorkbookModel } from '$lib/types/workbook';

const n = (v: number): Cell => ({ v, t: 'currency', fmt: '"$"#,##0.00' });
const t = (v: string): Cell => ({ v, t: 'text' });

/** A sheet with one honest total and one the page got wrong. */
function workbook(): WorkbookModel {
	return {
		title: 'Ledger',
		sheets: [
			{
				id: 's1',
				name: 'Invoices',
				headerRows: 1,
				columns: [{ label: 'Invoice' }, { label: 'Amount' }],
				rows: [
					[t('Invoice'), t('Amount')],
					[t('INV-1'), n(1200.5)],
					[t('INV-2'), n(800.25)],
					[t('INV-3'), n(999.25)],
					[
						t('Total'),
						{
							...n(3000),
							f: 'SUM(B2:B4)',
							raw: '3,000.00',
							check: {
								status: 'mismatch',
								message: 'The page printed 3000, but B2:B4 adds up to 3000.',
								computed: 3000
							}
						}
					]
				]
			}
		]
	};
}

describe('formula export', () => {
	it('writes a SUM formula on a currency total, with the computed value cached', async () => {
		const bytes = await buildWorkbook(workbook());
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(bytes as unknown as ArrayBuffer);

		const total = wb.getWorksheet('Invoices')!.getRow(5).getCell(2);
		const value = total.value as { formula: string; result: number };

		// A formula alongside a numeric type used to be dropped entirely: the
		// switch only emitted formulas for `t === 'formula'`.
		expect(value.formula).toBe('SUM(B2:B4)');
		// Cached so viewers that do not recalculate on open still show a number.
		expect(value.result).toBe(3000);
		// And it keeps its money format rather than reverting to General.
		expect(total.numFmt).toBe('"$"#,##0.00');
	});

	it('makes a total that did not reconcile impossible to miss in Excel', async () => {
		const bytes = await buildWorkbook(workbook());
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(bytes as unknown as ArrayBuffer);

		const total = wb.getWorksheet('Invoices')!.getRow(5).getCell(2);

		expect(total.note).toBeDefined();
		expect(JSON.stringify(total.note)).toContain('CHECK THIS');
		expect(total.fill).toMatchObject({ type: 'pattern' });
		expect(total.font?.bold).toBe(true);
	});
});
