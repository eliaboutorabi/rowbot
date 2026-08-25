import { describe, expect, it } from 'vitest';
import { evaluateFormula, type FormulaContext } from './formula';
import type { Cell } from './types/workbook';

const n = (v: number): Cell => ({ v, t: 'number' });
const t = (v: string): Cell => ({ v, t: 'text' });
const blank = (): Cell => ({ v: null, t: 'blank' });

const ctx: FormulaContext = {
	current: 'Ledger',
	sheets: [
		{
			name: 'Ledger',
			rows: [
				[t('Region'), t('Units'), t('Revenue')],
				[t('North America'), n(10), n(100)],
				[t('EMEA'), n(20), n(250)],
				[t('APAC'), n(30), blank()],
				[t('LATAM'), n(40), t('n/a')]
			]
		},
		{ name: 'Regional Summary', rows: [[t('Total'), n(7)]] }
	]
};

const value = (src: string) => {
	const r = evaluateFormula(src, ctx);
	return r.ok ? r.value : `ERROR: ${r.error}`;
};

describe('evaluateFormula', () => {
	it('sums a range on the current sheet', () => {
		expect(value('SUM(B2:B5)')).toBe(100);
	});

	it('accepts a leading equals sign, as a person would type it', () => {
		expect(value('=SUM(B2:B5)')).toBe(100);
	});

	it('reaches another sheet, quoted when the name has a space', () => {
		expect(value("='Regional Summary'!B1")).toBe(7);
		expect(value('=Ledger!B2')).toBe(10);
	});

	it('does the arithmetic between sheets that summary sheets are made of', () => {
		expect(value("=SUM(Ledger!B2:B5) - 'Regional Summary'!B1")).toBe(93);
	});

	it('skips blanks and text inside a range, as Excel does', () => {
		// C2:C5 holds 100, 250, a blank and the text "n/a".
		expect(value('SUM(C2:C5)')).toBe(350);
		expect(value('COUNT(C2:C5)')).toBe(2);
		expect(value('AVERAGE(C2:C5)')).toBe(175);
	});

	it('reads a bare reference to a blank cell as zero', () => {
		expect(value('C4')).toBe(0);
		expect(value('C4 + 5')).toBe(5);
	});

	it('honours precedence and brackets', () => {
		expect(value('2 + 3 * 4')).toBe(14);
		expect(value('(2 + 3) * 4')).toBe(20);
		expect(value('2 ^ 3 ^ 2')).toBe(512);
		expect(value('-B2 + 15')).toBe(5);
	});

	it('rounds and takes absolutes', () => {
		expect(value('ROUND(SUM(B2:B5) / 3, 2)')).toBe(33.33);
		expect(value('ABS(0 - B2)')).toBe(10);
	});

	it('clears floating-point dust', () => {
		expect(value('0.1 + 0.2')).toBe(0.3);
	});

	it('names the sheet it could not find', () => {
		expect(value("='Nowhere'!A1")).toBe('ERROR: There is no sheet called “Nowhere”.');
	});

	it('refuses a range where a single value belongs, and says what to do', () => {
		expect(value('B2:B5 + 1')).toMatch(/wrap it in SUM/);
		expect(value('B2:B5')).toMatch(/wrap it in SUM/);
	});

	it('refuses a function it cannot compute rather than guessing', () => {
		expect(value('VLOOKUP(A1, B:B, 2)')).toMatch(/not supported/);
	});

	it('reports a division by zero instead of returning Infinity', () => {
		expect(value('B2 / 0')).toMatch(/divides by zero/);
	});

	it('never throws on malformed input', () => {
		for (const bad of ['', '=', 'SUM(', ')', 'SUM(B2:B5', '1 +', '@@@', 'B2 !! B3']) {
			expect(() => evaluateFormula(bad, ctx)).not.toThrow();
			expect(evaluateFormula(bad, ctx).ok).toBe(false);
		}
	});
});
