/**
 * Client-side model of an agent run.
 *
 * Consumes the SSE protocol and keeps an ordered timeline the activity feed
 * renders directly: assistant prose, tool calls with their streaming
 * arguments and progress, and subagent lanes — in the order they happened.
 */
import type { AgentEvent, TodoItem, ToolCallView, UsageTotals } from '$lib/types/events';
import type { WorkbookModel } from '$lib/types/workbook';

export type RunStatus = 'idle' | 'streaming' | 'done' | 'interrupted' | 'error' | 'cancelled';

export type TimelineItem =
	| { kind: 'user'; id: string; text: string; at: number }
	| { kind: 'assistant'; id: string; text: string; at: number }
	| { kind: 'tool'; id: string; call: ToolCallView }
	/**
	 * A plan, in the place the agent made it. Re-planning pushes a new one
	 * rather than rewriting the last, because changing your mind halfway is an
	 * event in the conversation, not a silent edit to something at the top.
	 */
	| { kind: 'plan'; id: string; todos: TodoItem[]; at: number }
	| { kind: 'notice'; id: string; text: string; tone: 'error' | 'info'; at: number };

/** Same steps in the same order — a status change, not a new plan. */
function sameSteps(a: TodoItem[], b: TodoItem[]): boolean {
	return a.length === b.length && a.every((todo, i) => todo.content === b[i]?.content);
}

export interface InterruptState {
	id: string;
	question: string;
	payload?: unknown;
}

/** Parses an SSE byte stream into events, tolerating chunk boundaries. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		let boundary: number;
		while ((boundary = buffer.indexOf('\n\n')) !== -1) {
			const frame = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);

			const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
			if (!dataLine) continue;
			try {
				yield JSON.parse(dataLine.slice(5).trim()) as AgentEvent;
			} catch {
				// A malformed frame is not worth killing the run over.
			}
		}
	}
}

let sequence = 0;
const nextId = () => `t${++sequence}`;

/**
 * SvelteKit's `error()` replies with `{ message }`. Reading it as text and
 * slicing showed the reader raw JSON; this hands back the sentence inside.
 */
async function failureMessage(response: Response): Promise<string> {
	const body = await response.text().catch(() => '');
	try {
		const parsed = JSON.parse(body);
		if (typeof parsed?.message === 'string' && parsed.message) return parsed.message;
	} catch {
		// Not JSON — fall through to the raw body.
	}
	return body.slice(0, 300) || `The run could not start (${response.status}).`;
}

export class RunState {
	status = $state<RunStatus>('idle');
	timeline = $state<TimelineItem[]>([]);
	todos = $state<TodoItem[]>([]);
	workbook = $state<WorkbookModel | null>(null);
	workbookVersion = $state(0);
	usage = $state<UsageTotals>({ input: 0, output: 0, reasoning: 0 });
	interrupt = $state<InterruptState | null>(null);
	activeSubagents = $state<string[]>([]);
	error = $state<string | null>(null);
	/** Set when the last failure was a spent allowance rather than a fault. */
	outOfAllowance = $state(false);
	startedAt = $state<number | null>(null);

	#controller: AbortController | null = null;
	/**
	 * Tool call id → its index in `timeline`, so updates are O(1).
	 * Deliberately a plain Map: it is a private lookup that no template reads,
	 * and reactivity here would cost re-renders for nothing.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#toolIndex = new Map<string, number>();

	readonly busy = $derived(this.status === 'streaming');

	readonly runningTools = $derived(
		this.timeline.filter(
			(item): item is Extract<TimelineItem, { kind: 'tool' }> =>
				item.kind === 'tool' && item.call.status === 'running'
		)
	);

	constructor(initialWorkbook?: WorkbookModel | null) {
		if (initialWorkbook) this.workbook = initialWorkbook;
	}

	/**
	 * Seeds the feed from a previous run's checkpoint, so reopening a document
	 * shows the conversation that produced its workbook.
	 *
	 * Restored tool calls are re-registered in the id index: a follow-up turn
	 * can then stream updates into the same cards rather than duplicating them.
	 */
	restore(items: TimelineItem[], todos: TodoItem[] = []) {
		if (this.timeline.length || !items.length) return;

		// The checkpoint stores only the final state of the plan, not each
		// revision, so a restored run shows one plan at the top rather than
		// inventing a history of re-plans that we cannot actually recover.
		this.timeline = todos.length
			? [{ kind: 'plan' as const, id: 'restored-plan', todos, at: 0 }, ...items]
			: items;
		this.todos = todos;
		this.status = 'done';

		this.#toolIndex.clear();
		items.forEach((item, index) => {
			if (item.kind === 'tool') this.#toolIndex.set(item.call.id, index);
		});
	}

	reset() {
		this.timeline = [];
		this.todos = [];
		this.interrupt = null;
		this.error = null;
		this.activeSubagents = [];
		this.#toolIndex.clear();
	}

	stop() {
		this.#controller?.abort();
	}

	/** Sends a user turn (or resumes an interrupt) and consumes the response. */
	async send(options: {
		documentId: string;
		message?: string;
		resume?: unknown;
		model: string;
		effort: string;
	}) {
		if (this.busy) return;

		this.error = null;
		this.outOfAllowance = false;
		this.status = 'streaming';
		this.startedAt = Date.now();

		if (options.message) {
			this.timeline.push({
				kind: 'user',
				id: nextId(),
				text: options.message,
				at: Date.now()
			});
		}
		if (options.resume !== undefined) this.interrupt = null;

		this.#controller = new AbortController();

		try {
			const response = await fetch('/api/agent/stream', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(options),
				signal: this.#controller.signal
			});

			if (!response.ok || !response.body) {
				// 402 means the account is out of allowance — a state to act on,
				// not a fault to retry, so the composer offers Settings instead.
				this.outOfAllowance = response.status === 402;
				throw new Error(await failureMessage(response));
			}

			for await (const event of readEvents(response.body)) this.#apply(event);
		} catch (cause) {
			if ((cause as Error)?.name === 'AbortError') {
				this.status = 'cancelled';
				this.#closeOpenTools('Stopped');
			} else {
				this.status = 'error';
				this.error = cause instanceof Error ? cause.message : 'The run failed.';
				this.#closeOpenTools('Interrupted by an error');
			}
		} finally {
			this.#controller = null;
			if (this.status === 'streaming') this.status = 'done';
		}
	}

	#closeOpenTools(reason: string) {
		for (const item of this.timeline) {
			if (item.kind === 'tool' && item.call.status === 'running') {
				item.call.status = 'error';
				item.call.error = reason;
				item.call.endedAt = Date.now();
			}
		}
		this.timeline = [...this.timeline];
	}

	#tool(id: string): ToolCallView | null {
		const index = this.#toolIndex.get(id);
		if (index === undefined) return null;
		const item = this.timeline[index];
		return item?.kind === 'tool' ? item.call : null;
	}

	/** Assistant text streams in as deltas; append to the tail if it's still open. */
	#appendText(delta: string) {
		const tail = this.timeline.at(-1);
		if (tail?.kind === 'assistant') {
			tail.text += delta;
			this.timeline = [...this.timeline];
			return;
		}
		this.timeline.push({ kind: 'assistant', id: nextId(), text: delta, at: Date.now() });
	}

	#apply(event: AgentEvent) {
		switch (event.type) {
			case 'text':
				if (event.delta) this.#appendText(event.delta);
				break;

			case 'todos': {
				this.todos = event.items;

				// Marking one step in progress leaves the step list identical, so it
				// updates the plan already on screen. A different list of steps is a
				// re-plan and earns its own place in the timeline.
				const last = this.timeline.findLast((item) => item.kind === 'plan');
				if (last?.kind === 'plan' && sameSteps(last.todos, event.items)) {
					last.todos = event.items;
				} else {
					this.timeline.push({
						kind: 'plan',
						id: nextId(),
						todos: event.items,
						at: Date.now()
					});
				}
				break;
			}

			case 'tool:start': {
				this.#toolIndex.set(event.id, this.timeline.length);
				this.timeline.push({
					kind: 'tool',
					id: event.id,
					call: {
						id: event.id,
						name: event.name,
						status: 'running',
						startedAt: Date.now(),
						subagent: event.subagent,
						progress: []
					}
				});
				break;
			}

			case 'tool:args': {
				/*
				 * Deliberately dropped. The feed showed the tail of this raw JSON
				 * while a call was in flight, which read as a bug rather than as
				 * transparency — and accumulating it reallocated the whole timeline
				 * on every token, re-rendering the feed for text nobody wanted to
				 * see. The row shows the tool's own label until `tool:ready`
				 * delivers arguments worth describing.
				 */
				break;
			}

			case 'tool:ready': {
				const call = this.#tool(event.id);
				if (!call) break;
				call.args = event.args;
				this.timeline = [...this.timeline];
				break;
			}

			case 'tool:progress': {
				const call = this.#tool(event.id);
				if (!call) break;
				call.progress.push(event.progress);
				this.timeline = [...this.timeline];
				break;
			}

			case 'tool:end': {
				const call = this.#tool(event.id);
				if (!call) break;
				call.status = event.ok ? 'ok' : 'error';
				call.result = event.result;
				call.error = event.error;
				call.endedAt = Date.now();
				this.timeline = [...this.timeline];
				break;
			}

			case 'subagent:start':
				if (!this.activeSubagents.includes(event.name)) {
					this.activeSubagents = [...this.activeSubagents, event.name];
				}
				break;

			case 'subagent:end':
				this.activeSubagents = this.activeSubagents.filter((n) => n !== event.name);
				break;

			case 'workbook':
				this.workbook = event.workbook;
				this.workbookVersion = event.version;
				break;

			case 'usage':
				this.usage = event.usage;
				break;

			case 'interrupt':
				this.interrupt = { id: event.id, question: event.question, payload: event.payload };
				break;

			case 'error':
				this.error = event.message;
				this.timeline.push({
					kind: 'notice',
					id: nextId(),
					text: event.message,
					tone: 'error',
					at: Date.now()
				});
				break;

			case 'done':
				this.status =
					event.status === 'interrupted'
						? 'interrupted'
						: event.status === 'cancelled'
							? 'cancelled'
							: 'done';
				break;
		}
	}
}
