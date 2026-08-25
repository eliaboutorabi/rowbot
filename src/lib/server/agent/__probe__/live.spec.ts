/**
 * Opt-in end-to-end test: a real PDF, real Mistral OCR, a real GPT-5.6 run,
 * asserted through the same event protocol the browser consumes.
 *
 * Run with ROWBOT_LIVE=1. Skipped by default so the normal suite stays fast
 * and free.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '$lib/server/db';
import { document as documentTable, documentPage, user } from '$lib/server/db/schema';
import { putDocument } from '$lib/server/storage';
import { buildWorkbook } from '$lib/server/xlsx/build';
import type { AgentEvent } from '$lib/types/events';
import { streamRun, type StreamRunResult } from '../stream';

const live = process.env.ROWBOT_LIVE === '1';
const DUMP = process.env.ROWBOT_PROBE_OUT;

async function seed() {
	const userId = 'probe-user';
	const documentId = 'probe-doc';

	await db
		.insert(user)
		.values({
			id: userId,
			name: 'Probe',
			email: 'probe@example.test',
			emailVerified: false,
			createdAt: new Date(),
			updatedAt: new Date()
		})
		.onConflictDoNothing();

	const bytes = new Uint8Array(readFileSync(join(import.meta.dirname, 'test-tables.pdf')));
	const stored = await putDocument(userId, documentId, 'test-tables.pdf', bytes, 'application/pdf');

	await db.delete(documentTable).where(eq(documentTable.id, documentId));
	await db.insert(documentTable).values({
		id: documentId,
		userId,
		name: 'test-tables.pdf',
		originalFilename: 'test-tables.pdf',
		mimeType: 'application/pdf',
		sizeBytes: bytes.length,
		blobUrl: stored.url,
		blobPathname: stored.pathname,
		status: 'pending',
		createdAt: new Date(),
		updatedAt: new Date()
	});

	return {
		documentId,
		runId: 'probe-run',
		userId,
		filename: 'test-tables.pdf',
		mimeType: 'application/pdf'
	};
}

describe.runIf(live)('Rowbot end to end', () => {
	it('extracts a two-page report into a reviewable workbook', async () => {
		const context = await seed();
		const result: { current?: StreamRunResult } = {};
		const events: AgentEvent[] = [];

		for await (const event of streamRun(
			{
				context,
				model: 'gpt-5.6-terra',
				effort: 'low',
				threadId: `probe-${Date.now()}`,
				input: {
					messages: [
						{ role: 'user', content: 'Convert every table in this document into a clean workbook.' }
					]
				}
			},
			result
		)) {
			events.push(event);
		}

		if (DUMP) writeFileSync(DUMP, events.map((e) => JSON.stringify(e)).join('\n'));

		const kinds = new Set(events.map((e) => e.type));
		const byType = <T extends AgentEvent['type']>(type: T) =>
			events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);

		// The UI depends on every one of these arriving.
		expect(kinds).toContain('run');
		expect(kinds).toContain('todos');
		expect(kinds).toContain('tool:start');
		expect(kinds).toContain('tool:end');
		expect(kinds).toContain('workbook');
		expect(kinds).toContain('usage');
		expect(byType('done')[0]?.status).toBe('complete');

		// Planning really happened, not just a single-shot answer.
		const finalTodos = byType('todos').at(-1)!.items;
		expect(finalTodos.length).toBeGreaterThan(1);
		expect(finalTodos.every((t) => t.status === 'completed')).toBe(true);

		// Every tool call that started also finished.
		const started = byType('tool:start').map((e) => e.id);
		const ended = new Set(byType('tool:end').map((e) => e.id));
		expect(started.filter((id) => !ended.has(id))).toEqual([]);

		// OCR progress reached the UI at page granularity.
		const progress = byType('tool:progress').map((e) => e.progress.kind);
		expect(progress).toContain('ocr:start');
		expect(progress).toContain('ocr:page');
		expect(progress).toContain('ocr:done');

		expect(byType('usage').at(-1)!.usage.input).toBeGreaterThan(0);

		// The workbook itself.
		const workbook = result.current!.workbook;
		expect(workbook.sheets).toHaveLength(3);
		expect(workbook.title).not.toBe('Untitled');

		const revenue = workbook.sheets.find((s) => /revenue/i.test(s.name));
		expect(revenue, `no revenue sheet in ${workbook.sheets.map((s) => s.name)}`).toBeDefined();
		const na = revenue!.rows.find((r) => r[0]?.v === 'North America')!;
		expect(na.slice(1, 5).map((c) => c.v)).toEqual([12430, 13905, 15220, 16880]);
		expect(na[5].v).toBe(58435);

		// The two-row merged header survived the whole pipeline.
		const margins = workbook.sheets.find((s) => s.headerRows === 2);
		expect(margins, 'no sheet kept its two-row header').toBeDefined();
		expect(margins!.rows[0][0].merge).toEqual({ rs: 2, cs: 1 });

		// OCR pages were persisted for the source viewer.
		const pages = await db
			.select()
			.from(documentPage)
			.where(eq(documentPage.documentId, context.documentId));
		expect(pages).toHaveLength(2);
		expect(pages[0].blocksJson.length).toBeGreaterThan(0);

		// And it opens as a real Excel file.
		const xlsx = new ExcelJS.Workbook();
		await xlsx.xlsx.load((await buildWorkbook(workbook)) as unknown as ArrayBuffer);
		expect(xlsx.worksheets).toHaveLength(3);
		const sheet = xlsx.getWorksheet(revenue!.name)!;
		expect(sheet.getCell('B2').value).toBe(12430);
	}, 600_000);
});
