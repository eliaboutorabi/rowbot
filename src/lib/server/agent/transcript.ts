/**
 * Rebuilding a past conversation from its checkpoint.
 *
 * Everything the agent said and did is already durable — the LibSqlSaver
 * writes a checkpoint at every superstep, and the newest one holds the whole
 * message history. Reopening a document used to show an empty feed anyway,
 * because nothing ever read it back.
 *
 * This turns that history into the same `TimelineItem[]` the live SSE stream
 * produces, so the activity feed renders a restored run and a running one
 * through exactly one code path.
 */
import type { TodoItem, ToolCallView } from '$lib/types/events';
import { checkpointer } from './checkpointer';

/** The client's timeline shape. Kept structural to avoid importing a `.svelte.ts` module on the server. */
export type TranscriptItem =
	| { kind: 'user'; id: string; text: string; at: number }
	| { kind: 'assistant'; id: string; text: string; at: number }
	| { kind: 'tool'; id: string; call: ToolCallView }
	| { kind: 'notice'; id: string; text: string; tone: 'error' | 'info'; at: number };

/** The same shape the live `interrupt` event carries, so one UI path serves both. */
export interface PendingQuestion {
	id: string;
	question: string;
	payload: unknown;
}

export interface Transcript {
	items: TranscriptItem[];
	todos: TodoItem[];
	/** A question the run is still parked on, if there is one. */
	interrupt: PendingQuestion | null;
}

const EMPTY: Transcript = { items: [], todos: [], interrupt: null };

/**
 * The question a suspended run is waiting on.
 *
 * LangGraph parks it in the checkpoint's pending writes under the
 * `__interrupt__` channel rather than in a state channel, which is why
 * reading `channel_values` alone never found it — and why closing the tab on
 * a question used to strand the run for good. The feed came back on reload,
 * the question did not, and the composer offered to send a new message that
 * the graph, waiting for a resume, was in no position to accept.
 */
function pendingQuestion(
	writes: readonly (readonly [string, string, unknown])[] | undefined
): PendingQuestion | null {
	for (const write of writes ?? []) {
		const [, channel, value] = write;
		if (channel !== '__interrupt__') continue;

		const entry = value as { id?: string; value?: unknown };
		const asked = entry?.value;
		return {
			id: entry?.id ?? 'interrupt',
			question:
				typeof asked === 'string'
					? asked
					: ((asked as { question?: string })?.question ??
						'The agent is waiting for your decision.'),
			payload: asked
		};
	}
	return null;
}

/* ------------------------------------------------------------------ */
/* Reading LangChain messages without depending on their class shape   */
/* ------------------------------------------------------------------ */

interface RawToolCall {
	id?: string;
	name?: string;
	args?: Record<string, unknown>;
}

interface RawMessage {
	id?: string;
	content?: unknown;
	tool_calls?: RawToolCall[];
	tool_call_id?: string;
	name?: string;
	status?: string;
	type?: string;
	role?: string;
	_getType?: () => string;
	getType?: () => string;
}

/**
 * Whether a checkpoint deserialises into `BaseMessage` instances or plain
 * objects depends on the serde and the LangChain version, so the type is read
 * from whichever of the four places actually carries it.
 */
function messageType(message: RawMessage): string {
	const fromMethod = message.getType?.() ?? message._getType?.();
	return String(fromMethod ?? message.type ?? message.role ?? '').toLowerCase();
}

/** Message content is a string, or an array of typed blocks. */
function textOf(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';

	return content
		.map((block) => {
			if (typeof block === 'string') return block;
			if (block && typeof block === 'object') {
				const record = block as Record<string, unknown>;
				if (record.type === 'text' && typeof record.text === 'string') return record.text;
			}
			return '';
		})
		.join('')
		.trim();
}

/** Tool results are summarised to a line, matching what the live stream sends. */
function summarize(content: unknown): string {
	const text = textOf(content).trim();
	if (!text) return '';
	const [first] = text.split('\n');
	return first.length > 200 ? `${first.slice(0, 199)}…` : first;
}

/* ------------------------------------------------------------------ */

export async function readTranscript(threadId: string): Promise<Transcript> {
	let tuple;
	try {
		tuple = await checkpointer().getTuple({ configurable: { thread_id: threadId } });
	} catch (cause) {
		// A transcript is a nicety; never let a bad checkpoint blank the page.
		console.error('[rowbot] could not read transcript', cause);
		return EMPTY;
	}

	const asked = pendingQuestion(
		tuple?.pendingWrites as readonly (readonly [string, string, unknown])[] | undefined
	);

	const values = tuple?.checkpoint?.channel_values as Record<string, unknown> | undefined;
	if (!values) return { ...EMPTY, interrupt: asked };

	const messages = Array.isArray(values.messages) ? (values.messages as RawMessage[]) : [];
	const todos = Array.isArray(values.todos) ? (values.todos as TodoItem[]) : [];

	const items: TranscriptItem[] = [];
	/** tool_call_id → index in `items`, so a result can find its call. */
	const pending = new Map<string, number>();
	let seq = 0;
	const id = () => `restored-${++seq}`;

	for (const message of messages) {
		const type = messageType(message);

		if (type === 'human' || type === 'user') {
			const text = textOf(message.content).trim();
			if (text) items.push({ kind: 'user', id: id(), text, at: 0 });
			continue;
		}

		if (type === 'ai' || type === 'aimessagechunk' || type === 'assistant') {
			const text = textOf(message.content).trim();
			if (text) items.push({ kind: 'assistant', id: id(), text, at: 0 });

			for (const call of message.tool_calls ?? []) {
				const callId = call.id ?? id();
				pending.set(callId, items.length);
				items.push({
					kind: 'tool',
					id: id(),
					call: {
						id: callId,
						name: call.name ?? 'tool',
						args: call.args,
						// A call with no matching result was cut off mid-flight —
						// showing it as an error is truer than showing it as running.
						status: 'error',
						error: 'Interrupted',
						// No wall-clock is stored per message, and inventing one would
						// put a made-up duration on every restored card.
						startedAt: 0,
						progress: []
					} satisfies ToolCallView
				});
			}
			continue;
		}

		if (type === 'tool') {
			const index = message.tool_call_id ? pending.get(message.tool_call_id) : undefined;
			if (index === undefined) continue;

			const entry = items[index];
			if (entry?.kind !== 'tool') continue;

			const failed = message.status === 'error';
			entry.call.status = failed ? 'error' : 'ok';
			entry.call.error = failed ? summarize(message.content) : undefined;
			entry.call.result = failed ? undefined : summarize(message.content);
		}
	}

	return { items, todos, interrupt: asked };
}
