/**
 * Regression test for a bug that made the reviewer useless: a declarative
 * subagent is compiled without the parent's `stateSchema`, so the `workbook`
 * channel did not exist inside it and every audit reported an empty workbook.
 *
 * Run with ROWBOT_LIVE=1.
 */
import { describe, expect, it } from 'vitest';
import { auditorSubagent, chatModel } from '../index';
import { sheetFromHtml } from '$lib/server/ocr/html-table';
import type { WorkbookModel } from '$lib/types/workbook';

const live = process.env.ROWBOT_LIVE === '1';

const TABLE = `<table><thead><tr><th>Region</th><th>Q1</th><th>Q2</th><th>Total</th></tr></thead><tr><td>EMEA</td><td>8,120</td><td>8,640</td><td>16,760</td></tr><tr><td>APAC</td><td>5,600</td><td>6,215</td><td>11,000</td></tr></table>`;

describe.runIf(live)('sheet-auditor', () => {
	it('can read the workbook the parent built, and catches a broken total', async () => {
		const sheet = sheetFromHtml(TABLE, { id: 's1', name: 'Revenue by Region' });
		const workbook: WorkbookModel = { title: 'Test', sheets: [sheet] };

		const { runnable } = auditorSubagent(chatModel('gpt-5.6-terra', 'low'));

		const result = await runnable.invoke(
			{
				messages: [
					{
						role: 'user',
						content:
							'Audit the sheet "Revenue by Region". Check every Total against the sum of the quarters.'
					}
				],
				workbook
			},
			{
				context: {
					documentId: 'test',
					runId: 'test',
					userId: 'test',
					filename: 'test.pdf',
					mimeType: 'application/pdf'
				},
				recursionLimit: 20
			}
		);

		// Content arrives either as a string or as an array of content blocks.
		const text = (content: unknown): string => {
			if (typeof content === 'string') return content;
			if (!Array.isArray(content)) return '';
			return content
				.map((block) =>
					block && typeof block === 'object' && 'text' in block ? String(block.text) : ''
				)
				.join('');
		};

		const messages = result.messages as Array<{ content: unknown }>;
		const transcript = messages.map((m) => text(m.content)).join('\n');

		// The original failure mode.
		expect(transcript).not.toMatch(/workbook is empty|no sheets|contains no sheets/i);

		// It really read the data.
		expect(transcript).toContain('EMEA');

		// APAC's printed total is wrong: 5,600 + 6,215 = 11,815, not 11,000.
		const verdict = text(messages.at(-1)?.content);
		expect(verdict).toMatch(/APAC|11,?815|11,?000/);
	}, 180_000);
});
