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
