import { describe, expect, it } from 'vitest';
import { renderInline, renderMarkdown, renderReferences } from './markdown';

describe('renderMarkdown', () => {
	it('renders the subset the agent actually writes', () => {
		const html = renderMarkdown('Created **three sheets**:\n\n- Revenue\n- Headcount');
		expect(html).toContain('<strong class="font-semibold">three sheets</strong>');
		expect(html).toContain('<li>Revenue</li>');
		expect(html).toContain('<li>Headcount</li>');
	});

	it('renders numbered lists and inline code', () => {
		const html = renderMarkdown('1. First\n2. Use `read_sheet`');
		expect(html).toContain('<ol');
		expect(html).toContain('<code');
		expect(html).toContain('read_sheet');
	});

	it('never lets markup in the model output reach the DOM', () => {
		const html = renderMarkdown('<img src=x onerror="alert(1)"> and <script>alert(2)</script>');
		expect(html).not.toContain('<img');
		expect(html).not.toContain('<script');
		expect(html).toContain('&lt;img');
		expect(html).toContain('&lt;script');
	});

	it('escapes quotes so an attribute cannot be broken out of', () => {
		expect(renderMarkdown('say "hi" and \'bye\'')).toContain('&quot;hi&quot;');
	});

	it('leaves snake_case identifiers alone', () => {
		expect(renderMarkdown('the set_workbook_title tool')).toContain('set_workbook_title');
	});

	it('keeps paragraphs separate', () => {
		const html = renderMarkdown('First para.\n\nSecond para.');
		expect(html.match(/<p /g)).toHaveLength(2);
	});
});

describe('workbook references', () => {
	it('turns a valid reference into a clickable chip carrying the raw ref', () => {
		const html = renderMarkdown('The total in [[Revenue!F7]] does not reconcile.');
		expect(html).toContain('data-ref="Revenue!F7"');
		expect(html).toContain('>F7</button>');
	});

	it('labels rows and columns the way a person says them', () => {
		expect(renderMarkdown('[[Ledger!5:5]]')).toContain('>row 5</button>');
		expect(renderMarkdown('[[Ledger!C:C]]')).toContain('>column C</button>');
	});

	it('survives a quoted sheet name through HTML escaping', () => {
		// The text is escaped before this runs, so the quotes arrive as &#39;.
		const html = renderMarkdown("[['Revenue by Region'!B2:B6]]");
		expect(html).toContain('data-ref="\'Revenue by Region\'!B2:B6"');
		expect(html).toContain('>B2:B6</button>');
	});

	it('leaves a malformed reference as the literal text the model wrote', () => {
		// A chip that goes nowhere is worse than no chip.
		const html = renderMarkdown('see [[not a reference]] and [[Sheet!]]');
		expect(html).not.toContain('data-ref');
		expect(html).toContain('[[not a reference]]');
	});

	it('still escapes hostile input inside a reference', () => {
		const html = renderMarkdown('[[<img src=x onerror=alert(1)>!A1]]');
		expect(html).not.toContain('<img');
	});
});

describe('renderReferences', () => {
	it('turns an attached reference into the chip the agent’s replies get', () => {
		const html = renderReferences(
			"Regarding [['Course Transcript'!A:A]]: take the row column out."
		);

		expect(html).toContain('data-ref');
		expect(html).not.toContain('[[');
	});

	it('leaves a person’s prose alone', () => {
		// Their message is not markdown. Someone who types an asterisk means an
		// asterisk, and a stray underscore should not silently italicise a name.
		const html = renderReferences('call the sheet *final* and rename total_units');

		expect(html).toBe('call the sheet *final* and rename total_units');
	});

	it('escapes anything that looks like markup', () => {
		expect(renderReferences('<img src=x onerror=alert(1)>')).not.toContain('<img');
	});

	it('leaves a malformed reference as the text it was', () => {
		// A chip that goes nowhere is worse than no chip.
		expect(renderReferences('[[not a reference]]')).toContain('[[not a reference]]');
	});
});

describe('renderInline', () => {
	it('renders references without wrapping in a block element', () => {
		// Used inside an existing <p>; a nested <p> is invalid and brings margins
		// that fight the surrounding layout.
		const html = renderInline('See [[Revenue!D6]] for the total.');
		expect(html).toContain('data-ref="Revenue!D6"');
		expect(html).not.toContain('<p');
	});

	it('escapes hostile input the same way the block renderer does', () => {
		expect(renderInline('<script>alert(1)</script>')).not.toContain('<script');
	});
});

describe('tables', () => {
	const RECONCILIATION = [
		'| Line | Invoice | Net | Printed Gross | Difference |',
		'|---:|---|---:|---:|---:|',
		'| 032 | SI-4232 | 2,247.10 | 2,669.52 | **(27.00)** |'
	].join('\n');

	it('renders a pipe table as a table', () => {
		const html = renderMarkdown(RECONCILIATION);
		expect(html).toContain('<table');
		expect(html).toContain('<thead>');
		expect(html).toContain('<th');
		expect(html).toContain('SI-4232');
		// The delimiter row is structure, not content.
		expect(html).not.toContain('---');
	});

	it('takes each column\u2019s alignment from the delimiter row', () => {
		const html = renderMarkdown(RECONCILIATION);
		const heads = [...html.matchAll(/<th class="([^"]*)"/g)].map((m) => m[1]);
		expect(heads[0]).toContain('text-right');
		expect(heads[1]).toContain('text-start');
		expect(heads[4]).toContain('text-right');
	});

	it('centres a column marked :--:', () => {
		const html = renderMarkdown('| a |\n|:-:|\n| 1 |');
		expect(html).toContain('text-center');
	});

	it('still formats inside a cell', () => {
		const html = renderMarkdown(RECONCILIATION);
		expect(html).toContain('<strong class="font-semibold">(27.00)</strong>');
	});

	it('turns a reference in a cell into a chip', () => {
		const html = renderMarkdown('| where |\n|---|\n| [[Ledger!B4]] |');
		expect(html).toContain('data-ref="Ledger!B4"');
	});

	it('pads a short row and drops the overflow of a long one', () => {
		const html = renderMarkdown('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
		const rows = [...html.matchAll(/<tr>(?:(?!<\/tr>).)*<\/tr>/g)].map((m) => m[0]);
		// Header plus two body rows, every one of them two cells wide.
		expect(rows).toHaveLength(3);
		for (const row of rows) expect(row.match(/<t[hd]/g)).toHaveLength(2);
	});

	it('scrolls sideways rather than squeezing the columns', () => {
		expect(renderMarkdown(RECONCILIATION)).toContain('overflow-x-auto');
	});

	it('leaves prose that merely contains a pipe alone', () => {
		const html = renderMarkdown('Use A | B to split the column.');
		expect(html).not.toContain('<table');
		expect(html).toContain('<p');
	});

	it('needs a delimiter row, not just pipes', () => {
		expect(renderMarkdown('| a | b |\n| c | d |')).not.toContain('<table');
	});

	it('ends the table at a blank line', () => {
		const html = renderMarkdown('| a |\n|---|\n| 1 |\n\nAfterwards.');
		expect(html).toContain('Afterwards.');
		expect(html.indexOf('</table>')).toBeLessThan(html.indexOf('Afterwards.'));
	});

	it('keeps an escaped pipe inside its cell', () => {
		const html = renderMarkdown('| formula |\n|---|\n| a \\| b |');
		expect(html).toContain('a | b');
		expect(html.match(/<td/g)).toHaveLength(1);
	});

	it('cannot be used to smuggle markup in', () => {
		const html = renderMarkdown('| x |\n|---|\n| <img src=x onerror=alert(1)> |');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img');
	});
});
