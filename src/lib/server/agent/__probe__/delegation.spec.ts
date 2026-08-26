/**
 * Forces one delegation and checks that it is attributed.
 *
 * ROWBOT_LIVE=1 npx vitest run src/lib/server/agent/__probe__/delegation.spec.ts
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document as documentTable, user } from '$lib/server/db/schema';
import { putDocument } from '$lib/server/storage';
import type { AgentEvent } from '$lib/types/events';
import { DEFAULT_MODEL } from '../models';
import { streamRun, type StreamRunResult } from '../stream';

const live = process.env.ROWBOT_LIVE === '1';
const NAME = 'calder-revenue-bad-total.pdf';

describe.runIf(live)('delegation', () => {
	it('attributes a subagent by name, and does not repeat its report as assistant text', async () => {
		const userId = 'probe-user';
		const documentId = 'probe-delegation';
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

		const bytes = new Uint8Array(readFileSync(join(homedir(), 'Downloads', 'examples', NAME)));
		const stored = await putDocument(userId, documentId, NAME, bytes, 'application/pdf');
		await db.delete(documentTable).where(eq(documentTable.id, documentId));
		await db.insert(documentTable).values({
			id: documentId,
			userId,
			name: NAME,
			originalFilename: NAME,
			mimeType: 'application/pdf',
			sizeBytes: bytes.length,
			blobUrl: stored.url,
			blobPathname: stored.pathname,
			status: 'pending',
			createdAt: new Date(),
			updatedAt: new Date()
		});

		const result: { current?: StreamRunResult } = {};
		const events: AgentEvent[] = [];
		for await (const event of streamRun(
			{
				context: {
					documentId,
					runId: 'probe-delegation-run',
					userId,
					filename: NAME,
					mimeType: 'application/pdf'
				},
				model: DEFAULT_MODEL,
				effort: 'low',
				threadId: `probe-delegation-${process.pid}`,
				input: {
					messages: [
						{
							role: 'user',
							content:
								'Import the one table, then hand the finished sheet to the sheet-auditor ' +
								'subagent with the task tool for a check. Keep everything else minimal.'
						}
					]
				}
			},
			result
		)) {
			events.push(event);
		}

		const starts = events.filter((e) => e.type === 'tool:start');
		const tasks = starts.filter((e) => e.name === 'task');
		expect(tasks.length, 'no delegation happened, so nothing was tested').toBeGreaterThan(0);

		const delegated = starts.filter((e) => e.subagent);
		console.log(
			'delegated calls:',
			delegated.map((e) => `${e.subagent}/${e.name}`).join(', ') || '(none)'
		);
		console.log(
			'subagent:start:',
			events.filter((e) => e.type === 'subagent:start').map((e) => e.name)
		);

		// The name has to be the real one, not the generic fallback.
		expect(delegated.length).toBeGreaterThan(0);
		expect(delegated.every((e) => e.subagent === 'sheet-auditor')).toBe(true);
		expect(events.filter((e) => e.type === 'subagent:start').map((e) => e.name)).toContain(
			'sheet-auditor'
		);

		// The subagent's report reaches the reviewer once, as the task's result.
		const prose = events
			.filter((e): e is Extract<AgentEvent, { type: 'text' }> => e.type === 'text')
			.map((e) => e.delta)
			.join('');
		const report = events.find(
			(e) => e.type === 'tool:end' && tasks.some((t) => t.id === e.id) && 'result' in e
		);
		const opening = (report && 'result' in report ? report.result : '')?.slice(0, 40) ?? '';
		expect(opening.length, 'the delegation returned nothing').toBeGreaterThan(10);
		expect(prose).not.toContain(opening);
	}, 600_000);
});
