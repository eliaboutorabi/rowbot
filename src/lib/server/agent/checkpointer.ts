/**
 * A LangGraph checkpointer backed by libSQL (local file in dev, Turso in
 * production).
 *
 * This is the piece that makes Rowbot's harness feel like a real workspace
 * rather than a one-shot request. Every superstep is persisted, so a run can
 * be interrupted mid-extraction, resumed in a later HTTP request, corrected by
 * the user, or picked up tomorrow — which matters a lot on Vercel, where a
 * single invocation is capped well below a long multi-page extraction.
 *
 * The in-tree savers don't fit: the SQLite one needs a local file (there is no
 * durable disk on Vercel) and the Postgres one is the wrong database.
 */
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import {
	BaseCheckpointSaver,
	WRITES_IDX_MAP,
	type ChannelVersions,
	type Checkpoint,
	type CheckpointListOptions,
	type CheckpointMetadata,
	type CheckpointTuple,
	type PendingWrite,
	type SerializerProtocol
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { db as defaultDb } from '$lib/server/db';
import { checkpoint as checkpointTable, checkpointWrite } from '$lib/server/db/schema';

type Db = typeof defaultDb;

/** libSQL hands blobs back in a few shapes depending on driver and dialect. */
function toBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}
	if (typeof value === 'string') return new TextEncoder().encode(value);
	throw new TypeError(`Unsupported blob value of type ${typeof value}`);
}

/** Drizzle's buffer mode expects a Node Buffer on the way in. */
function toBuffer(bytes: Uint8Array): Buffer {
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function threadIdOf(config: RunnableConfig, action: string): string {
	const threadId = config.configurable?.thread_id as string | undefined;
	if (!threadId) {
		throw new Error(
			`Cannot ${action} without a thread_id. Pass { configurable: { thread_id } } when invoking the agent.`
		);
	}
	return threadId;
}

export class LibSqlSaver extends BaseCheckpointSaver {
	constructor(
		private readonly db: Db = defaultDb,
		serde?: SerializerProtocol
	) {
		super(serde);
	}

	private async hydrate(row: {
		threadId: string;
		checkpointNs: string;
		checkpointId: string;
		parentCheckpointId: string | null;
		type: string | null;
		checkpoint: unknown;
		metadata: unknown;
	}): Promise<CheckpointTuple> {
		const type = row.type ?? 'json';
		const [checkpoint, metadata, pendingWrites] = await Promise.all([
			this.serde.loadsTyped(type, toBytes(row.checkpoint)) as Promise<Checkpoint>,
			this.serde.loadsTyped(type, toBytes(row.metadata)) as Promise<CheckpointMetadata>,
			this.pendingWrites(row.threadId, row.checkpointNs, row.checkpointId)
		]);

		const tuple: CheckpointTuple = {
			config: {
				configurable: {
					thread_id: row.threadId,
					checkpoint_ns: row.checkpointNs,
					checkpoint_id: row.checkpointId
				}
			},
			checkpoint,
			metadata,
			pendingWrites
		};

		if (row.parentCheckpointId) {
			tuple.parentConfig = {
				configurable: {
					thread_id: row.threadId,
					checkpoint_ns: row.checkpointNs,
					checkpoint_id: row.parentCheckpointId
				}
			};
		}
		return tuple;
	}

	private async pendingWrites(
		threadId: string,
		checkpointNs: string,
		checkpointId: string
	): Promise<CheckpointTuple['pendingWrites']> {
		const rows = await this.db
			.select()
			.from(checkpointWrite)
			.where(
				and(
					eq(checkpointWrite.threadId, threadId),
					eq(checkpointWrite.checkpointNs, checkpointNs),
					eq(checkpointWrite.checkpointId, checkpointId)
				)
			)
			.orderBy(asc(checkpointWrite.taskId), asc(checkpointWrite.idx));

		return Promise.all(
			rows.map(
				async (row) =>
					[
						row.taskId,
						row.channel,
						await this.serde.loadsTyped(row.type ?? 'json', toBytes(row.value))
					] as [string, string, unknown]
			)
		);
	}

	async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
		const threadId = config.configurable?.thread_id as string | undefined;
		if (!threadId) return undefined;
		const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
		const checkpointId = config.configurable?.checkpoint_id as string | undefined;

		const where = checkpointId
			? and(
					eq(checkpointTable.threadId, threadId),
					eq(checkpointTable.checkpointNs, checkpointNs),
					eq(checkpointTable.checkpointId, checkpointId)
				)
			: and(eq(checkpointTable.threadId, threadId), eq(checkpointTable.checkpointNs, checkpointNs));

		// Checkpoint ids are UUID6, so lexical order is chronological order.
		const [row] = await this.db
			.select()
			.from(checkpointTable)
			.where(where)
			.orderBy(desc(checkpointTable.checkpointId))
			.limit(1);

		return row ? this.hydrate(row) : undefined;
	}

	async *list(
		config: RunnableConfig,
		options?: CheckpointListOptions
	): AsyncGenerator<CheckpointTuple> {
		const threadId = config.configurable?.thread_id as string | undefined;
		if (!threadId) return;
		const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
		const before = options?.before?.configurable?.checkpoint_id as string | undefined;

		const conditions = [
			eq(checkpointTable.threadId, threadId),
			eq(checkpointTable.checkpointNs, checkpointNs)
		];
		if (before) conditions.push(lt(checkpointTable.checkpointId, before));

		const rows = await this.db
			.select()
			.from(checkpointTable)
			.where(and(...conditions))
			.orderBy(desc(checkpointTable.checkpointId))
			// Metadata is a serialised blob, so `filter` can only be applied after
			// hydration. Over-fetch when filtering so `limit` still means something.
			.limit(options?.filter ? (options.limit ?? 10) * 10 : (options?.limit ?? 1000));

		let yielded = 0;
		for (const row of rows) {
			if (options?.limit !== undefined && yielded >= options.limit) return;
			const tuple = await this.hydrate(row);
			if (options?.filter) {
				const metadata = (tuple.metadata ?? {}) as Record<string, unknown>;
				const matches = Object.entries(options.filter).every(
					([key, value]) => metadata[key] === value
				);
				if (!matches) continue;
			}
			yielded++;
			yield tuple;
		}
	}

	async put(
		config: RunnableConfig,
		checkpoint: Checkpoint,
		metadata: CheckpointMetadata,
		_newVersions?: ChannelVersions
	): Promise<RunnableConfig> {
		const threadId = threadIdOf(config, 'save a checkpoint');
		const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
		const parentCheckpointId = config.configurable?.checkpoint_id as string | undefined;

		const [[type, serializedCheckpoint], [, serializedMetadata]] = await Promise.all([
			this.serde.dumpsTyped(checkpoint),
			this.serde.dumpsTyped(metadata)
		]);

		await this.db
			.insert(checkpointTable)
			.values({
				threadId,
				checkpointNs,
				checkpointId: checkpoint.id,
				parentCheckpointId: parentCheckpointId ?? null,
				type,
				checkpoint: toBuffer(serializedCheckpoint),
				metadata: toBuffer(serializedMetadata)
			})
			.onConflictDoUpdate({
				target: [
					checkpointTable.threadId,
					checkpointTable.checkpointNs,
					checkpointTable.checkpointId
				],
				set: {
					parentCheckpointId: parentCheckpointId ?? null,
					type,
					checkpoint: toBuffer(serializedCheckpoint),
					metadata: toBuffer(serializedMetadata)
				}
			});

		return {
			configurable: {
				thread_id: threadId,
				checkpoint_ns: checkpointNs,
				checkpoint_id: checkpoint.id
			}
		};
	}

	async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
		if (!writes.length) return;

		const threadId = threadIdOf(config, 'save pending writes');
		const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
		const checkpointId = config.configurable?.checkpoint_id as string | undefined;
		if (!checkpointId) {
			throw new Error('Cannot save pending writes without a checkpoint_id in the config.');
		}
		const rows = await Promise.all(
			writes.map(async ([channel, value], i) => {
				const [type, serialized] = await this.serde.dumpsTyped(value);
				return {
					threadId,
					checkpointNs,
					checkpointId,
					taskId,
					// Special channels (errors, interrupts) map to negative indices so
					// they can never collide with ordinary positional writes.
					idx: WRITES_IDX_MAP[channel] ?? i,
					channel,
					type,
					value: toBuffer(serialized)
				};
			})
		);

		await Promise.all(
			rows.map((row) => {
				const insert = this.db.insert(checkpointWrite).values(row);
				// Positive indices are write-once; negative (special) ones overwrite.
				return row.idx >= 0
					? insert.onConflictDoNothing()
					: insert.onConflictDoUpdate({
							target: [
								checkpointWrite.threadId,
								checkpointWrite.checkpointNs,
								checkpointWrite.checkpointId,
								checkpointWrite.taskId,
								checkpointWrite.idx
							],
							set: { channel: row.channel, type: row.type, value: row.value }
						});
			})
		);
	}

	async deleteThread(threadId: string): Promise<void> {
		await Promise.all([
			this.db.delete(checkpointWrite).where(eq(checkpointWrite.threadId, threadId)),
			this.db.delete(checkpointTable).where(eq(checkpointTable.threadId, threadId))
		]);
	}

	/** Rows written by threads that no longer have a `run`, for housekeeping. */
	async countCheckpoints(threadId: string): Promise<number> {
		const [row] = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(checkpointTable)
			.where(eq(checkpointTable.threadId, threadId));
		return row?.count ?? 0;
	}
}

let cached: LibSqlSaver | undefined;

/** Process-wide saver; safe to reuse across requests. */
export function checkpointer(): LibSqlSaver {
	cached ??= new LibSqlSaver();
	return cached;
}
