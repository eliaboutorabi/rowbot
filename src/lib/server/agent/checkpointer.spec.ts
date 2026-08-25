import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	emptyCheckpoint,
	type Checkpoint,
	type CheckpointMetadata
} from '@langchain/langgraph-checkpoint';
import * as schema from '$lib/server/db/schema';
import { LibSqlSaver } from './checkpointer';

const DDL = [
	`CREATE TABLE checkpoint (
		thread_id text NOT NULL,
		checkpoint_ns text NOT NULL DEFAULT '',
		checkpoint_id text NOT NULL,
		parent_checkpoint_id text,
		type text,
		checkpoint blob NOT NULL,
		metadata blob NOT NULL,
		created_at integer NOT NULL DEFAULT 0,
		PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
	)`,
	`CREATE TABLE checkpoint_write (
		thread_id text NOT NULL,
		checkpoint_ns text NOT NULL DEFAULT '',
		checkpoint_id text NOT NULL,
		task_id text NOT NULL,
		idx integer NOT NULL,
		channel text NOT NULL,
		type text,
		value blob,
		task_path text NOT NULL DEFAULT '',
		PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
	)`
];

let dir: string;
let saver: LibSqlSaver;

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), 'rowbot-ckpt-'));
	const client = createClient({ url: `file:${join(dir, 'test.db')}` });
	for (const ddl of DDL) await client.execute(ddl);
	saver = new LibSqlSaver(drizzle(client, { schema }) as never);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function makeCheckpoint(id: string, values: Record<string, unknown>): Checkpoint {
	return { ...emptyCheckpoint(), id, channel_values: values };
}

const meta = (step: number): CheckpointMetadata =>
	({ source: 'loop', step, parents: {} }) as CheckpointMetadata;

const cfg = (thread: string, id?: string) => ({
	configurable: { thread_id: thread, checkpoint_ns: '', ...(id ? { checkpoint_id: id } : {}) }
});

describe('LibSqlSaver', () => {
	it('round-trips a checkpoint with its channel values', async () => {
		const ckpt = makeCheckpoint('00000000-0000-6000-8000-000000000001', {
			messages: [{ role: 'user', content: 'extract the tables' }]
		});
		const out = await saver.put(cfg('t1'), ckpt, meta(0), {});
		expect(out.configurable?.checkpoint_id).toBe(ckpt.id);

		const tuple = await saver.getTuple(cfg('t1'));
		expect(tuple?.checkpoint.id).toBe(ckpt.id);
		expect(tuple?.checkpoint.channel_values.messages).toEqual([
			{ role: 'user', content: 'extract the tables' }
		]);
		expect(tuple?.metadata?.step).toBe(0);
	});

	it('returns the newest checkpoint when no id is given, and links the parent', async () => {
		const first = makeCheckpoint('00000000-0000-6000-8000-000000000010', { n: 1 });
		const second = makeCheckpoint('00000000-0000-6000-8000-000000000011', { n: 2 });

		await saver.put(cfg('t2'), first, meta(0), {});
		await saver.put(cfg('t2', first.id), second, meta(1), {});

		const latest = await saver.getTuple(cfg('t2'));
		expect(latest?.checkpoint.channel_values.n).toBe(2);
		expect(latest?.parentConfig?.configurable?.checkpoint_id).toBe(first.id);

		// An explicit id still reaches back to the earlier state — this is what
		// makes "undo and re-run from here" possible.
		const earlier = await saver.getTuple(cfg('t2', first.id));
		expect(earlier?.checkpoint.channel_values.n).toBe(1);
	});

	it('lists a thread newest-first and honours before/limit', async () => {
		const ids = ['20', '21', '22'].map((n) => `00000000-0000-6000-8000-0000000000${n}`);
		let parent: string | undefined;
		for (const [i, id] of ids.entries()) {
			await saver.put(cfg('t3', parent), makeCheckpoint(id, { n: i }), meta(i), {});
			parent = id;
		}

		const all = [];
		for await (const t of saver.list(cfg('t3'))) all.push(t.checkpoint.id);
		expect(all).toEqual([...ids].reverse());

		const limited = [];
		for await (const t of saver.list(cfg('t3'), { limit: 2 })) limited.push(t.checkpoint.id);
		expect(limited).toEqual([ids[2], ids[1]]);

		const before = [];
		for await (const t of saver.list(cfg('t3'), { before: cfg('t3', ids[1]) })) {
			before.push(t.checkpoint.id);
		}
		expect(before).toEqual([ids[0]]);
	});

	it('filters a listing by metadata', async () => {
		const found = [];
		for await (const t of saver.list(cfg('t3'), { filter: { step: 1 } })) {
			found.push(t.checkpoint.id);
		}
		expect(found).toEqual(['00000000-0000-6000-8000-000000000021']);
	});

	it('stores pending writes and replays them with the checkpoint', async () => {
		const ckpt = makeCheckpoint('00000000-0000-6000-8000-000000000030', {});
		await saver.put(cfg('t4'), ckpt, meta(0), {});

		await saver.putWrites(
			cfg('t4', ckpt.id),
			[
				['messages', { role: 'assistant' }],
				['files', { a: 1 }]
			],
			'task-1'
		);

		const tuple = await saver.getTuple(cfg('t4'));
		expect(tuple?.pendingWrites).toEqual([
			['task-1', 'messages', { role: 'assistant' }],
			['task-1', 'files', { a: 1 }]
		]);
	});

	it('does not let a replayed task duplicate its writes', async () => {
		const ckpt = makeCheckpoint('00000000-0000-6000-8000-000000000031', {});
		await saver.put(cfg('t5'), ckpt, meta(0), {});

		await saver.putWrites(cfg('t5', ckpt.id), [['messages', 'first']], 'task-1');
		await saver.putWrites(cfg('t5', ckpt.id), [['messages', 'second']], 'task-1');

		const tuple = await saver.getTuple(cfg('t5'));
		expect(tuple?.pendingWrites).toEqual([['task-1', 'messages', 'first']]);
	});

	it('lets an interrupt overwrite its own slot', async () => {
		const ckpt = makeCheckpoint('00000000-0000-6000-8000-000000000032', {});
		await saver.put(cfg('t6'), ckpt, meta(0), {});

		await saver.putWrites(cfg('t6', ckpt.id), [['__interrupt__', 'awaiting review']], 'task-1');
		await saver.putWrites(cfg('t6', ckpt.id), [['__interrupt__', 'approved']], 'task-1');

		const tuple = await saver.getTuple(cfg('t6'));
		expect(tuple?.pendingWrites).toEqual([['task-1', '__interrupt__', 'approved']]);
	});

	it('deletes every trace of a thread', async () => {
		const ckpt = makeCheckpoint('00000000-0000-6000-8000-000000000040', {});
		await saver.put(cfg('t7'), ckpt, meta(0), {});
		await saver.putWrites(cfg('t7', ckpt.id), [['messages', 'x']], 'task-1');

		await saver.deleteThread('t7');

		expect(await saver.getTuple(cfg('t7'))).toBeUndefined();
		expect(await saver.countCheckpoints('t7')).toBe(0);
	});

	it('ignores unknown threads rather than throwing', async () => {
		expect(await saver.getTuple(cfg('nope'))).toBeUndefined();
	});
});
