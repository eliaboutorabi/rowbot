/**
 * Runs the filled Schedule C through the real agent, end to end, and dumps
 * every event so the run can be read rather than guessed at.
 *
 *   ROWBOT_LIVE=1 ROWBOT_PROBE_OUT=/tmp/sc-run.jsonl \
 *     npx vitest run src/lib/server/agent/__probe__/schedule-c.spec.ts
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document as documentTable, user } from '$lib/server/db/schema';
import { putDocument } from '$lib/server/storage';
import type { AgentEvent } from '$lib/types/events';
import { DEFAULT_EFFORT, DEFAULT_MODEL } from '../models';
import { streamRun, type StreamRunResult } from '../stream';

const live = process.env.ROWBOT_LIVE === '1';
const DUMP = process.env.ROWBOT_PROBE_OUT ?? '/tmp/sc-run.jsonl';
const FILE = join(homedir(), 'Downloads', 'examples', 'irs-schedule-c.pdf');
const PROMPT = process.env.ROWBOT_PROMPT ?? 'Turn this into a spreadsheet.';

async function seed() {
	const userId = 'probe-user';
	const documentId = 'probe-schedule-c';
	const name = 'irs-schedule-c.pdf';

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

	const bytes = new Uint8Array(readFileSync(FILE));
	const stored = await putDocument(userId, documentId, name, bytes, 'application/pdf');

	await db.delete(documentTable).where(eq(documentTable.id, documentId));
	await db.insert(documentTable).values({
		id: documentId,
		userId,
		name,
		originalFilename: name,
		mimeType: 'application/pdf',
		sizeBytes: bytes.length,
		blobUrl: stored.url,
		blobPathname: stored.pathname,
		status: 'pending',
		createdAt: new Date(),
		updatedAt: new Date()
	});

	return { documentId, runId: 'probe-sc-run', userId, filename: name, mimeType: 'application/pdf' };
}

describe.runIf(live)('Schedule C, through the agent', () => {
	it('produces a workbook worth looking at', async () => {
		const context = await seed();
		const result: { current?: StreamRunResult } = {};
		const events: AgentEvent[] = [];

		for await (const event of streamRun(
			{
				context,
				model: DEFAULT_MODEL,
				effort: DEFAULT_EFFORT,
				threadId: `probe-sc-${process.pid}`,
				input: { messages: [{ role: 'user', content: PROMPT }] }
			},
			result
		)) {
			events.push(event);
		}

		writeFileSync(DUMP, events.map((e) => JSON.stringify(e)).join('\n'));

		const named = (id: string) =>
			events.find((e) => e.type === 'tool:start' && e.id === id)?.name ?? '?';
		const done = events.find((e) => e.type === 'done');
		const workbook = result.current?.workbook;

		const report: string[] = [
			`\n${events.length} events -> ${DUMP}`,
			`status: ${done && 'status' in done ? done.status : '(none)'}`,
			`title:  ${workbook?.title}`
		];

		for (const sheet of workbook?.sheets ?? []) {
			const filled = sheet.rows.flat().filter((cell) => cell.v !== null && cell.v !== '').length;
			report.push(
				`  "${sheet.name}"  ${sheet.rows.length} x ${sheet.rows[0]?.length ?? 0}, ${filled} filled`
			);
		}

		// What the reviewer actually reads, and the two things that used to be
		// wrong with it: an arithmetic answer that displayed as `Result: {`, and a
		// subagent's report repeated into the assistant's own message.
		report.push('\ndelegations:');
		for (const event of events) {
			if (event.type === 'subagent:start') report.push(`  ${event.name}`);
		}
		report.push('\nanalysis answers:');
		for (const event of events) {
			if (event.type === 'tool:end' && named(event.id) === 'run_analysis' && 'result' in event) {
				report.push(`  ${event.result}`);
			}
		}
		report.push('\nwhat the reviewer is told:');
		report.push(
			events
				.filter((e): e is Extract<AgentEvent, { type: 'text' }> => e.type === 'text')
				.map((e) => e.delta)
				.join('')
				.trim()
				.replace(/^/gm, '  ')
		);
		console.log(report.join('\n'));

		expect(workbook).toBeDefined();
	}, 900_000);
});
