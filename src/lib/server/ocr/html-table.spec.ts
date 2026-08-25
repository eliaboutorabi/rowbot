import { describe, expect, it } from 'vitest';
import { headerLabels, parseTableHtml, splitTables } from './html-table';
import { coerce, parseNumeric } from '$lib/coerce';

// Verbatim output from mistral-ocr-4-1 on a two-page report.
const REVENUE = `<table><thead><tr><th>Region</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Total</th></tr></thead><tr><td>North America</td><td>12,430</td><td>13,905</td><td>15,220</td><td>16,880</td><td>58,435</td></tr><tr><td>EMEA</td><td>8,120</td><td>8,640</td><td>9,310</td><td>10,050</td><td>36,120</td></tr></table>`;

const MERGED = `<table><thead><tr><th rowspan="2">Product</th><th colspan="2">2024</th><th colspan="2">2025</th></tr><tr><th>Rev</th><th>Margin</th><th>Rev</th><th>Margin</th></tr></thead><tr><td>Atlas Core</td><td>9,200</td><td>41.2%</td><td>11,450</td><td>44.0%</td></tr></table>`;

describe('parseTableHtml', () => {
	it('parses a flat table into a rectangular grid', () => {
		const { rows, headerRows, width } = parseTableHtml(REVENUE);
		expect(width).toBe(6);
		expect(headerRows).toBe(1);
		expect(rows).toHaveLength(3);
		expect(rows[0][0].v).toBe('Region');
		expect(rows[1][0].v).toBe('North America');
		// Thousands separators become real numbers.
		expect(rows[1][1]).toMatchObject({ v: 12430, t: 'number' });
		expect(rows[1][5]).toMatchObject({ v: 58435, t: 'number' });
	});

	it('expands rowspan and colspan while keeping merge anchors', () => {
		const { rows, headerRows, width } = parseTableHtml(MERGED);
		expect(width).toBe(5);
		expect(headerRows).toBe(2);

		// "Product" anchors a 2-row merge; the slot below is covered.
		expect(rows[0][0]).toMatchObject({ v: 'Product', merge: { rs: 2, cs: 1 } });
		expect(rows[1][0]).toMatchObject({ v: 'Product', covered: true });

		// "2024" spans two columns.
		expect(rows[0][1]).toMatchObject({ v: 2024, merge: { rs: 1, cs: 2 } });
		expect(rows[0][2].covered).toBe(true);

		// Second header row fills the slots the spans left open.
		expect(rows[1][1].v).toBe('Rev');
		expect(rows[1][2].v).toBe('Margin');

		// Percentages become fractions so Excel arithmetic works.
		expect(rows[2][2]).toMatchObject({ v: 0.412, t: 'percent', fmt: '0.0%' });
	});

	it('joins multi-row headers into readable column labels', () => {
		const { rows, headerRows, width } = parseTableHtml(MERGED);
		expect(headerLabels(rows, headerRows, width)).toEqual([
			'Product',
			'2024 – Rev',
			'2024 – Margin',
			'2025 – Rev',
			'2025 – Margin'
		]);
	});

	it('finds every table in a page of markup', () => {
		expect(splitTables(REVENUE + MERGED)).toHaveLength(2);
	});

	it('survives unclosed tags and stray entities', () => {
		const ragged = `<table><tr><th>A<th>B<tr><td>G&amp;A<td>7</table>`;
		const { rows, width } = parseTableHtml(ragged);
		expect(width).toBe(2);
		expect(rows[1][0].v).toBe('G&A');
		expect(rows[1][1].v).toBe(7);
	});
});

describe('parseNumeric', () => {
	it.each([
		['1,234.56', 1234.56],
		['1.234,56', 1234.56],
		['1 234,56', 1234.56],
		["1'234.56", 1234.56],
		['(1,234)', -1234],
		['1,234-', -1234],
		['$45,000', 45000],
		['€1.500', 1500],
		['12.5%', 12.5],
		['0.5', 0.5],
		['2024', 2024]
	])('parses %s', (input, expected) => {
		expect(parseNumeric(input)).toBe(expected);
	});

	it('rejects text that merely contains digits', () => {
		expect(parseNumeric('Q1 2024')).toBeNull();
		expect(parseNumeric('N/A')).toBeNull();
	});
});

describe('coerce', () => {
	it('treats accounting negatives as negative currency', () => {
		expect(coerce('($1,234.00)')).toMatchObject({ v: -1234, t: 'currency' });
	});

	it('maps placeholder dashes to blanks', () => {
		expect(coerce('—')).toMatchObject({ v: null, t: 'blank' });
		expect(coerce('N/A')).toMatchObject({ v: null, t: 'blank' });
	});

	it('only accepts dates it can read unambiguously', () => {
		expect(coerce('2025-01-31')).toMatchObject({ v: '2025-01-31', t: 'date' });
		expect(coerce('31/01/2025')).toMatchObject({ v: '2025-01-31', t: 'date' });
		expect(coerce('Jan 31, 2025')).toMatchObject({ v: '2025-01-31', t: 'date' });
		// Ambiguous day/month order stays text rather than silently guessing.
		expect(coerce('03/04/2025')).toMatchObject({ t: 'text' });
	});
});
