/**
 * Making a crashed thread resumable.
 *
 * A LangGraph step is all-or-nothing. When the tool node throws — a channel
 * conflict, a provider timeout, the 300s function cap — its writes are
 * discarded, but the assistant message that *asked* for those tools was
 * committed a step earlier. The checkpoint is then left holding tool calls
 * with no results, which is a message history no provider will accept: the
 * next turn fails with "tool_use without tool_result", and the thread is
 * bricked. The reviewer sees a document that errors on every message they
 * send, with no way back other than starting again.
 *
 * So before each turn the thread is checked and, if it is in that state,
 * closed off: every unanswered call gets a result saying it did not finish.
 * The history becomes valid, the model learns what was lost, and the run
 * carries on from there.
 */
import { ToolMessage } from '@langchain/core/messages';

interface ToolCall {
	id?: string;
	name?: string;
}

interface Snapshot {
	values?: { messages?: unknown[] };
	tasks?: readonly { interrupts?: readonly unknown[] }[];
}

interface Threadable {
	getState(config: unknown): Promise<Snapshot>;
	updateState(config: unknown, values: unknown): Promise<unknown>;
}

const INTERRUPTED =
	'This call did not finish: the run stopped before it returned, and nothing it ' +
	'would have written was saved. Call it again if you still need it — one call at ' +
	'a time, so a second failure cannot take the rest of the step with it.';

/** Tool calls an assistant message asked for and never got a result for. */
export function danglingToolCalls(messages: readonly unknown[]): ToolCall[] {
	const answered = new Set<string>();
	for (const message of messages) {
		const id = (message as { tool_call_id?: unknown })?.tool_call_id;
		if (typeof id === 'string') answered.add(id);
	}

	const open: ToolCall[] = [];
	for (const message of messages) {
		const calls = (message as { tool_calls?: unknown })?.tool_calls;
		if (!Array.isArray(calls)) continue;
		for (const call of calls as ToolCall[]) {
			if (typeof call?.id === 'string' && !answered.has(call.id)) open.push(call);
		}
	}
	return open;
}

/**
 * Closes off a thread left mid-step by a crash. Returns how many calls it had
 * to answer, so the caller can say so.
 *
 * A thread suspended on `ask_user` also has an unanswered tool call — but that
 * one is alive and waiting for the reviewer, so a thread with a live interrupt
 * is left exactly as it is.
 */
export async function healThread(agent: Threadable, threadId: string): Promise<number> {
	const config = { configurable: { thread_id: threadId } };

	let snapshot: Snapshot;
	try {
		snapshot = await agent.getState(config);
	} catch {
		// A thread with no checkpoint yet, or a checkpointer that cannot read it.
		// Either way there is nothing to repair and this must not stop the run.
		return 0;
	}

	if (snapshot?.tasks?.some((task) => task.interrupts?.length)) return 0;

	const open = danglingToolCalls(snapshot?.values?.messages ?? []);
	if (!open.length) return 0;

	await agent.updateState(config, {
		messages: open.map(
			(call) =>
				new ToolMessage({
					tool_call_id: call.id as string,
					name: call.name,
					content: INTERRUPTED,
					status: 'error'
				})
		)
	});

	return open.length;
}
