/**
 * Turns the harness's raw LangGraph stream into Rowbot's UI protocol.
 *
 * Three stream modes are merged here:
 *   `messages` — token-by-token assistant text and tool-argument deltas
 *   `updates`  — node results: tool messages, the plan, workbook operations
 *   `custom`   — fine-grained progress written from inside a tool
 *
 * Subgraphs are enabled so work delegated to a subagent shows up in its own
 * lane rather than silently disappearing into a single `task` call.
 */
import { AIMessageChunk, ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import type { AgentEvent, TodoItem, UsageTotals } from '$lib/types/events';
import type { WorkbookModel } from '$lib/types/workbook';
import { applyOps, emptyModel, type WorkbookOp } from './workbook-ops';
import { isProgressEnvelope } from './events';
import { createRowbotAgent } from './index';
import { healThread } from './heal';
import type { RowbotContext } from './state';
import type { Effort, ModelId } from './models';

export interface StreamRunOptions {
	context: RowbotContext;
	model: ModelId;
	effort: Effort;
	threadId: string;
	/** A new user turn, or `resume` to answer an outstanding interrupt. */
	input: { messages: Array<{ role: 'user'; content: string }> } | { resume: unknown };
	signal?: AbortSignal;
	/** Workbook state to fold ops onto, when resuming an existing thread. */
	initialWorkbook?: WorkbookModel;
}

export interface StreamRunResult {
	workbook: WorkbookModel;
	usage: UsageTotals;
	status: 'complete' | 'interrupted' | 'cancelled';
	/**
	 * How many times the workbook was written this turn. Zero means the turn
	 * only talked, and saving a revision identical to the last one would put
	 * noise in the document's history for nothing.
	 */
	revision: number;
}

/** `['tools:abc', 'sheet-auditor:1']` → `sheet-auditor` */
function subagentFrom(namespace: readonly string[] | undefined): string | undefined {
	if (!namespace?.length) return undefined;
	for (let i = namespace.length - 1; i >= 0; i--) {
		const segment = namespace[i].split(':')[0];
		if (segment && segment !== 'tools' && segment !== 'model_request') return segment;
	}
	return undefined;
}

function contentText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((block) =>
			typeof block === 'string'
				? block
				: block && typeof block === 'object' && (block as { type?: string }).type === 'text'
					? ((block as { text?: string }).text ?? '')
					: ''
		)
		.join('');
}

/** Tool results are for the model; the UI only needs a glanceable summary. */
function summarize(content: unknown, limit = 240): string {
	const text = contentText(content).trim();
	const firstLine = text.split('\n').find((l) => l.trim()) ?? '';
	return firstLine.length > limit ? `${firstLine.slice(0, limit - 1)}…` : firstLine;
}

function looksLikeFailure(content: unknown): boolean {
	const text = contentText(content);
	return /^(error|no sheet called|no file at|that document)/i.test(text.trim());
}

interface PendingCall {
	name: string;
	subagent?: string;
}

interface ToolResult {
	toolCallId: string;
	content: unknown;
}

/**
 * Tool results reach the updates stream in two shapes: a `ToolMessage` when
 * the tool returned a value, and a plain object when it returned a `Command`
 * carrying its own message. Both have to close the UI's tool card, or a card
 * that did real work spins forever.
 */
function asToolResult(message: unknown): ToolResult | null {
	if (message instanceof ToolMessage) {
		return { toolCallId: message.tool_call_id, content: message.content };
	}
	if (typeof message !== 'object' || message === null) return null;

	const candidate = message as {
		role?: string;
		type?: string;
		tool_call_id?: string;
		content?: unknown;
	};
	const isTool = candidate.role === 'tool' || candidate.type === 'tool';
	if (!isTool || typeof candidate.tool_call_id !== 'string') return null;
	return { toolCallId: candidate.tool_call_id, content: candidate.content };
}

/**
 * Runs one turn and yields UI events. The caller is responsible for persisting
 * the final workbook — `result` is populated once the generator completes.
 */
export async function* streamRun(
	options: StreamRunOptions,
	result: { current?: StreamRunResult }
): AsyncGenerator<AgentEvent> {
	const agent = createRowbotAgent({
		model: options.model,
		effort: options.effort,
		context: options.context
	});

	let workbook = options.initialWorkbook ?? emptyModel();
	let workbookVersion = 0;
	const usage: UsageTotals = { input: 0, output: 0, reasoning: 0 };
	const pending = new Map<string, PendingCall>();
	const openSubagents = new Set<string>();
	let interrupted = false;

	/**
	 * Kept current as the run goes, not written once at the end.
	 *
	 * The caller saves `result.current` from its catch block precisely so that
	 * a failed run does not throw away the sheets it had already built — but
	 * this was only assigned after the loop, so the one case it existed for was
	 * the one case it was empty. A reviewer watched three sheets appear and
	 * then found the document with none.
	 */
	const publish = (status: StreamRunResult['status'] = 'complete') => {
		result.current = { workbook, usage, status, revision: workbookVersion };
	};
	publish();

	yield {
		type: 'run',
		runId: options.context.runId,
		threadId: options.threadId,
		model: options.model,
		effort: options.effort
	};

	// A thread the last run crashed inside cannot take another message until
	// the calls it left open are answered. Cheap to check, and the difference
	// between a document that recovers and one that errors forever.
	if (!('resume' in options.input)) {
		const healed = await healThread(
			agent as unknown as Parameters<typeof healThread>[0],
			options.threadId
		);
		if (healed) {
			yield {
				type: 'notice',
				tone: 'info',
				text: `Picking up after an interrupted step — ${healed} unfinished tool call${
					healed === 1 ? '' : 's'
				} closed off.`
			};
		}
	}

	const input =
		'resume' in options.input ? new Command({ resume: options.input.resume }) : options.input;

	const stream = await agent.stream(input, {
		streamMode: ['updates', 'messages', 'custom'],
		subgraphs: true,
		configurable: { thread_id: options.threadId },
		context: options.context,
		signal: options.signal,
		recursionLimit: 120
	});

	for await (const chunk of stream as AsyncIterable<unknown>) {
		// With `subgraphs: true` every chunk is [namespace, mode, payload].
		const [namespace, mode, payload] = chunk as [string[], string, unknown];
		const subagent = subagentFrom(namespace);

		if (subagent && !openSubagents.has(subagent)) {
			openSubagents.add(subagent);
			yield { type: 'subagent:start', name: subagent };
		}

		if (mode === 'custom') {
			if (isProgressEnvelope(payload)) {
				yield { type: 'tool:progress', id: payload.toolCallId, progress: payload.progress };
			}
			continue;
		}

		if (mode === 'messages') {
			const [message] = payload as [unknown, Record<string, unknown>];
			if (!(message instanceof AIMessageChunk)) continue;

			const text = contentText(message.content);
			if (text) yield { type: 'text', delta: text };

			for (const part of message.tool_call_chunks ?? []) {
				// The opening chunk carries the name and id; the rest are argument
				// deltas identified only by index, so the id has to be remembered.
				if (part.name && part.id) {
					pending.set(part.id, { name: part.name, subagent });
					yield { type: 'tool:start', id: part.id, name: part.name, subagent };
				}
				if (part.args) {
					const id = part.id ?? [...pending.keys()].at(-1);
					if (id) yield { type: 'tool:args', id, delta: part.args };
				}
			}

			for (const call of message.tool_calls ?? []) {
				if (call.id && Object.keys(call.args ?? {}).length) {
					yield { type: 'tool:ready', id: call.id, args: call.args as Record<string, unknown> };
				}
			}

			const meta = message.usage_metadata;
			if (meta) {
				usage.input += meta.input_tokens ?? 0;
				usage.output += meta.output_tokens ?? 0;
				usage.reasoning += meta.output_token_details?.reasoning ?? 0;
				yield { type: 'usage', usage: { ...usage } };
			}
			continue;
		}

		if (mode !== 'updates') continue;

		const updates = payload as Record<string, Record<string, unknown> | undefined>;
		for (const [node, update] of Object.entries(updates)) {
			if (node === '__interrupt__') {
				interrupted = true;
				const interrupts = update as unknown as Array<{ id?: string; value?: unknown }>;
				for (const item of interrupts ?? []) {
					yield {
						type: 'interrupt',
						id: item.id ?? 'interrupt',
						question:
							typeof item.value === 'string'
								? item.value
								: ((item.value as { question?: string })?.question ??
									'The agent is waiting for your decision.'),
						payload: item.value
					};
				}
				continue;
			}
			if (!update) continue;

			if (Array.isArray(update.todos)) {
				yield { type: 'todos', items: update.todos as TodoItem[] };
			}

			if (Array.isArray(update.workbook)) {
				workbook = applyOps(workbook, update.workbook as WorkbookOp[]);
				workbookVersion++;
				publish();
				yield { type: 'workbook', workbook, version: workbookVersion };
			}

			for (const message of (update.messages as unknown[]) ?? []) {
				const toolResult = asToolResult(message);
				if (!toolResult) continue;
				const failed = looksLikeFailure(toolResult.content);
				yield {
					type: 'tool:end',
					id: toolResult.toolCallId,
					ok: !failed,
					...(failed
						? { error: summarize(toolResult.content) }
						: { result: summarize(toolResult.content) })
				};
				pending.delete(toolResult.toolCallId);
			}
		}
	}

	for (const name of openSubagents) yield { type: 'subagent:end', name };

	const status: StreamRunResult['status'] = interrupted ? 'interrupted' : 'complete';
	publish(status);
	yield { type: 'done', status };
}
