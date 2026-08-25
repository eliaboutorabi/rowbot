/**
 * Bridges a tool's `runtime.writer` to the SSE stream.
 *
 * LangGraph forwards anything written here as a `custom` stream event, which
 * the route turns into a `tool:progress` frame. That is how the UI can show
 * "page 7 of 12" while a single tool call is still in flight.
 */
import type { ToolProgress } from '$lib/types/events';

export const PROGRESS_MARKER = '__rowbot_progress__';

export interface ProgressEnvelope {
	[PROGRESS_MARKER]: true;
	/** Which tool call produced this, so parallel calls stay distinguishable. */
	toolCallId: string;
	progress: ToolProgress;
}

export function isProgressEnvelope(value: unknown): value is ProgressEnvelope {
	return (
		typeof value === 'object' &&
		value !== null &&
		PROGRESS_MARKER in value &&
		(value as ProgressEnvelope)[PROGRESS_MARKER] === true
	);
}

/** `emit` is a no-op when the graph is invoked outside a streaming context. */
export function emitProgress(runtime: {
	writer?: ((chunk: unknown) => void) | null;
	toolCallId: string;
}): (progress: ToolProgress) => void {
	const { writer, toolCallId } = runtime;
	if (!writer) return () => {};
	return (progress) => {
		try {
			writer({ [PROGRESS_MARKER]: true, toolCallId, progress } satisfies ProgressEnvelope);
		} catch {
			// A closed stream must never take the agent down mid-run.
		}
	};
}
