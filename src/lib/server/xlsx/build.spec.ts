import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbook, workbookFilename } from './build';
import { sheetFromHtml } from '../ocr/html-table';
import type { OcrResponse } from '../ocr/mistral';
import type { WorkbookModel } from '$lib/types/workbook';
import fixture from '../ocr/__fixtures__/report-ocr.json' with { type: 'json' };

const ocr = fixture as unknown as OcrResponse;

/** Rebuilds the workbook the way the agent's tools do, from real OCR output. */
function workbookFromFixture(): WorkbookModel {
	const sheets = ocr.pages.flatMap((page) =>
		(page.tables ?? []).map((table, i) =>
			sheetFromHtml(table.content, {
				id: `${page.index}-${table.id}`,
				name: `Page ${page.index + 1} Table ${i + 1}`,
				source: { pageIndex: page.index, tableId: table.id }
			})
		)
	);
	return { title: 'Northwind FY2025', sheets };
}

async function reopen(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(bytes as unknown as ArrayBuffer);
	return wb;
}

describe('buildWorkbook', () => {
	it('turns every OCR table into its own sheet', async () => {
		const model = workbookFromFixture();
		expect(model.sheets).toHaveLength(3);

		const wb = await reopen(await buildWorkbook(model));
		expect(wb.worksheets.map((w) => w.name)).toEqual([
			'Page 1 Table 1',
			'Page 1 Table 2',
			'Page 2 Table 1'
		]);
	});

	it('writes numbers as numbers Excel can total', async () => {
		const wb = await reopen(await buildWorkbook(workbookFromFixture()));
		const ws = wb.getWorksheet('Page 1 Table 1')!;

		expect(ws.getCell('A2').value).toBe('North America');
		expect(ws.getCell('B2').value).toBe(12430);
		expect(ws.getCell('F2').value).toBe(58435);
		expect(ws.getCell('B2').numFmt).toBe('#,##0');

		// The four quarters really do add up to the printed total.
		const quarters = ['B2', 'C2', 'D2', 'E2'].map((r) => ws.getCell(r).value as number);
		expect(quarters.reduce((a, b) => a + b, 0)).toBe(ws.getCell('F2').value);
	});

	it('keeps percentages as fractions with a percent format', async () => {
		const wb = await reopen(await buildWorkbook(workbookFromFixture()));
		const ws = wb.getWorksheet('Page 1 Table 2')!;
		expect(ws.getCell('E2').value).toBeCloseTo(0.051, 6);
		expect(ws.getCell('E2').numFmt).toBe('0.0%');
	});

	it('preserves the merged two-row header from the source page', async () => {
		const wb = await reopen(await buildWorkbook(workbookFromFixture()));
		const ws = wb.getWorksheet('Page 2 Table 1')!;

		expect(ws.getCell('A1').value).toBe('Product');
		expect(ws.getCell('B1').value).toBe(2024);
		expect(ws.getCell('B2').value).toBe('Rev');
		expect(ws.getCell('C2').value).toBe('Margin');

		// A1:A2 and B1:C1 are genuinely merged, not just visually aligned.
		expect(ws.getCell('A2').isMerged).toBe(true);
		expect(ws.getCell('C1').isMerged).toBe(true);
		expect(ws.getCell('A1').master.address).toBe('A1');
		expect(ws.getCell('A2').master.address).toBe('A1');
	});

	it('freezes the header rows and enables filtering', async () => {
		const wb = await reopen(await buildWorkbook(workbookFromFixture()));
		const ws = wb.getWorksheet('Page 2 Table 1')!;
		expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 2 });
		expect(ws.autoFilter).toBeTruthy();
	});

	it('flags low-confidence cells with an explanatory comment', async () => {
		const model = workbookFromFixture();
		model.sheets[0].rows[1][1].conf = 0.42;
		const wb = await reopen(await buildWorkbook(model));
		const cell = wb.getWorksheet('Page 1 Table 1')!.getCell('B2');
		expect(JSON.stringify(cell.note)).toContain('Low OCR confidence: 42%');
	});

	it('lets a column format override the one detected per cell', async () => {
		const model = workbookFromFixture();
		const sheet = model.sheets[1];
		// What `update_sheet` produces when asked for two decimal places.
		sheet.columns[4] = { ...sheet.columns[4], fmt: '0.00%' };
		for (let r = sheet.headerRows; r < sheet.rows.length; r++) sheet.rows[r][4].fmt = undefined;

		const wb = await reopen(await buildWorkbook(model));
		const cell = wb.getWorksheet(sheet.name)!.getCell('E2');
		expect(cell.numFmt).toBe('0.00%');
		expect(cell.value).toBeCloseTo(0.051, 6);
	});

	it('never emits a workbook with zero sheets', async () => {
		const wb = await reopen(await buildWorkbook({ title: 'Empty', sheets: [] }));
		expect(wb.worksheets).toHaveLength(1);
	});
});

describe('workbookFilename', () => {
	it('swaps the source extension for .xlsx', () => {
		expect(workbookFilename('Q4 report.pdf')).toBe('Q4 report.xlsx');
	});
});
