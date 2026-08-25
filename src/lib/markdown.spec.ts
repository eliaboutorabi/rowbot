import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

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
