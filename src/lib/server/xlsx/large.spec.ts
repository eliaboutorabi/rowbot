/**
 * A long table has to survive the whole way to the file.
 *
 * A ledger that runs across a dozen pages is the case Rowbot exists for, and
 * every layer between OCR and the download has a different way of failing at
 * scale: the op log replays every edit, the builder holds the sheet in memory,
 * and the route runs inside a 300-second function. These check the two that
 * are pure enough to check quickly — that a five-thousand-row sheet arrives
 * intact, with its formulas and its flags, in a file Excel will open.
 */
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbook } from './build';
import type { Cell, WorkbookModel } from '$lib/types/workbook';

const ROWS = 5000;
const COLUMNS = 8;

function longSheet(): WorkbookModel {
	const header: Cell[] = [{ v: 'Region', t: 'text' }];
	for (let c = 1; c < COLUMNS; c++) header.push({ v: `Q${c}`, t: 'text' });

	const rows: Cell[][] = [header];
	for (let r = 0; r < ROWS; r++) {
		const row: Cell[] = [{ v: `Row ${r + 1}`, t: 'text' }];
		for (let c = 1; c < COLUMNS; c++) {
			row.push({ v: r * COLUMNS + c, t: 'number', conf: c === 3 ? 0.6 : 0.99 });
		}
		rows.push(row);
	}

	// A total that reconciles, and one that does not — the two shapes the
	// builder styles differently.
	const total: Cell[] = [{ v: 'Total', t: 'text' }];
	for (let c = 1; c < COLUMNS; c++) {
		let sum = 0;
		for (let r = 0; r < ROWS; r++) sum += r * COLUMNS + c;
		total.push(
			c === 2
				? {
						v: sum - 1,
						t: 'number',
						raw: String(sum - 1),
						check: {
							status: 'mismatch',
							message: `The page printed ${sum - 1}, but the column adds up to ${sum}.`,
							computed: sum
						}
					}
				: {
						v: sum,
						t: 'number',
						f: `SUM(${String.fromCharCode(65 + c)}2:${String.fromCharCode(65 + c)}${ROWS + 1})`
					}
		);
	}
	rows.push(total);

	return {
		title: 'Long ledger',
		sheets: [
			{
				id: 's1',
				name: 'Ledger',
				headerRows: 1,
				columns: header.map((cell) => ({ label: String(cell.v) })),
				rows
			}
		]
	};
}

describe('a five-thousand-row sheet', () => {
	it('reaches the file with every row, formula and flag intact', async () => {
		const bytes = await buildWorkbook(longSheet());

		const book = new ExcelJS.Workbook();
		await book.xlsx.load(bytes as unknown as ArrayBuffer);
		const sheet = book.getWorksheet('Ledger');
		expect(sheet).toBeDefined();

		// Header + data + total.
		expect(sheet!.rowCount).toBe(ROWS + 2);

		// First and last data rows, so a truncation anywhere in between shows up.
		expect(sheet!.getCell('A2').value).toBe('Row 1');
		expect(sheet!.getCell(`A${ROWS + 1}`).value).toBe(`Row ${ROWS}`);

		const totalRow = ROWS + 2;
		// A reconciling total stays a live formula.
		const good = sheet!.getCell(`B${totalRow}`).value as { formula?: string };
		expect(good.formula).toContain('SUM(');

		// The disputed one keeps the page's figure and carries no formula, so the
		// file never shows a number that contradicts its own flag.
		const flagged = sheet!.getCell(`C${totalRow}`);
		expect(typeof flagged.value).toBe('number');
		expect(flagged.note).toBeDefined();
	});

	it('builds in a time a serverless function can afford', async () => {
		const started = process.hrtime.bigint();
		await buildWorkbook(longSheet());
		const seconds = Number(process.hrtime.bigint() - started) / 1e9;
		// Generous: the point is to catch an accidental quadratic, not to police
		// a few hundred milliseconds on a loaded CI box.
		expect(seconds).toBeLessThan(20);
	});
});
