/**
 * The wire protocol between the agent harness and the browser.
 *
 * The whole point of Rowbot's activity feed is that nothing the harness does
 * is hidden, so this is deliberately granular: planning, tool calls, tool
 * argument streaming, subagent delegation, per-page OCR progress and workbook
 * revisions all get their own event rather than being flattened into text.
 */
import type { WorkbookModel } from './workbook';

/** Fine-grained progress emitted from inside a tool via `runtime.writer`. */
export type ToolProgress =
	| { kind: 'ocr:start'; label: string; pages: string }
	| { kind: 'ocr:chunk'; label: string; index: number; total: number }
	| { kind: 'ocr:page'; page: number; tables: number; confidence: number | null }
	| { kind: 'ocr:done'; tables: number; pages: number }
	| { kind: 'sheet:written'; name: string; rows: number; columns: number }
	| { kind: 'sheet:removed'; name: string }
	| { kind: 'cells:edited'; sheet: string; count: number }
	| { kind: 'note'; text: string };

export interface TodoItem {
	content: string;
	status: 'pending' | 'in_progress' | 'completed';
}

export type ToolStatus = 'running' | 'ok' | 'error';

export interface ToolCallView {
	id: string;
	name: string;
	/** Parsed arguments once they finish streaming. */
	args?: Record<string, unknown>;
	status: ToolStatus;
	/** Short human-facing result summary. */
	result?: string;
	error?: string;
	startedAt: number;
	endedAt?: number;
	/** Name of the subagent that made the call, when nested. */
	subagent?: string;
	progress: ToolProgress[];
}

export interface UsageTotals {
	input: number;
	output: number;
	reasoning: number;
}

export type AgentEvent =
	/** Sent once, first, so the client can pin the thread. */
	| { type: 'run'; runId: string; threadId: string; model: string; effort: string }
	| { type: 'text'; delta: string }
	| { type: 'reasoning'; delta: string }
	| { type: 'todos'; items: TodoItem[] }
	| { type: 'tool:start'; id: string; name: string; subagent?: string }
	| { type: 'tool:args'; id: string; delta: string }
	| { type: 'tool:ready'; id: string; args: Record<string, unknown> }
	| { type: 'tool:progress'; id: string; progress: ToolProgress }
	| { type: 'tool:end'; id: string; ok: boolean; result?: string; error?: string }
	| { type: 'subagent:start'; name: string; description?: string }
	| { type: 'subagent:end'; name: string }
	| { type: 'workbook'; workbook: WorkbookModel; version: number }
	| { type: 'usage'; usage: UsageTotals }
	| { type: 'interrupt'; id: string; question: string; payload?: unknown }
	| { type: 'error'; message: string; recoverable: boolean }
	| { type: 'done'; status: 'complete' | 'interrupted' | 'cancelled' };

export const SSE_EVENT = 'rowbot';

export function encodeEvent(event: AgentEvent): string {
	return `event: ${SSE_EVENT}\ndata: ${JSON.stringify(event)}\n\n`;
}
