/**
 * The sandbox, exercised directly.
 *
 * The tool itself needs a graph runtime to call; what matters here is what the
 * code can and cannot reach, and that a bad script fails politely rather than
 * ending the run.
 */
import { describe, expect, it } from 'vitest';
import { analyse } from './analyse';
import type { WorkbookModel } from '$lib/types/workbook';

const invoice = (): WorkbookModel => ({
	title: 'Invoice',
	sheets: [
		{
			id: 's1',
			name: 'Items',
			headerRows: 1,
			columns: [],
			rows: [
				['Item', 'Qty', 'Unit', 'Discount', 'Amount'],
				['Marine rope', 40, 18.5, null, 740],
				['Stainless shackle', 120, 4.25, 0.05, 484.5],
				// The misread the tool exists for: 3 x 17.5 less 10% is not 350.87.
				['Bilge pump', 3, 17.5, 0.1, 350.87]
			].map((row) => row.map((v) => ({ v: v as string | number | null, t: 'text' as const })))
		}
	]
});

const run = (code: string) => analyse(invoice(), code);

describe('run_analysis', () => {
	it('hands back what the code returns', () => {
		expect(run('return 2 + 2;').result).toBe('4');
	});

	it('reads the sheet by name', () => {
		expect(run('return sheets["Items"].body.length;').result).toBe('3');
	});

	it('reads a column by its letter', () => {
		expect(run('return sheets["Items"].col("B");').result).toContain('120');
	});

	it('finds the row a column sum would never have caught', () => {
		const { result } = run(`
			const bad = [];
			for (const [i, row] of sheets['Items'].body.entries()) {
				const [, qty, unit, disc, amount] = row;
				const expected = round(qty * unit * (1 - (disc || 0)));
				if (Math.abs(expected - amount) > 0.01) bad.push({ row: i + 2, expected, amount });
			}
			return bad;
		`);
		expect(result).toContain('350.87');
		expect(result).toContain('47.25');
	});

	it('recovers a figure the reader could not, from the row around it', () => {
		// 350.87 / 3 / 0.9, which is the unit price the smudge hid.
		expect(run('return round(350.87 / 3 / 0.9);').result).toBe('129.95');
	});

	it('keeps the lines the code logged', () => {
		expect(run('log("checking", 3); return 1;').logs).toEqual(['checking 3']);
	});

	it('reports a script that will not compile instead of throwing', () => {
		const { result } = run('this is not javascript');
		expect(result).toContain('did not run');
	});

	it('reports a script that throws instead of ending the run', () => {
		expect(run('throw new Error("nope");').result).toContain('nope');
	});

	it('stops a script that will not', () => {
		const { result } = run('while (true) {}');
		expect(result).toContain('did not run');
	});

	it('cannot load a module', () => {
		expect(run('return require("node:fs");').result).toContain('did not run');
	});

	it('cannot reach the process it is running in', () => {
		expect(run('return process.env;').result).toContain('did not run');
	});

	it('cannot reach the network', () => {
		expect(run('return fetch("http://example.com");').result).toContain('did not run');
	});

	it('keeps the language intrinsics, dates among them', () => {
		// Deliberate. "Is this invoice overdue on Net 30" is arithmetic an
		// accountant wants, and a fresh V8 context carries Date either way — the
		// boundary being drawn here is around Node, not around JavaScript.
		expect(run('return new Date("2026-03-14").getUTCFullYear();').result).toBe('2026');
	});

	it('cannot reach the filesystem through a global', () => {
		expect(run('return globalThis.process ? "yes" : "no";').result).toBe('"no"');
	});

	it('says so plainly when the code returns nothing', () => {
		expect(run('const x = 1;').result).toContain('returned nothing');
	});
});
