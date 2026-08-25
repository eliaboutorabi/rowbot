import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { encodeEvent, type AgentEvent } from '$lib/types/events';
import { asEffort, asModelId } from '$lib/server/agent/models';
import { streamRun, type StreamRunResult } from '$lib/server/agent/stream';
import {
	addUsage,
	ensureRun,
	latestWorkbook,
	ownedDocument,
	saveWorkbook,
	setRunStatus
} from '$lib/server/runs';
import type { WorkbookModel } from '$lib/types/workbook';

/**
 * Hobby functions cap out at 300s. The harness is checkpointed, so hitting the
 * cap is recoverable — the client reconnects and the agent picks up from the
 * last completed step rather than starting over.
 */
export const config = { maxDuration: 300 };

interface Body {
	documentId: string;
	message?: string;
	/** Answer to an outstanding human-in-the-loop interrupt. */
	resume?: unknown;
	model?: string;
	effort?: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Sign in first.');

	const body = (await request.json()) as Body;
	if (!body.documentId) error(400, 'Which document?');
	if (body.message === undefined && body.resume === undefined) {
		error(400, 'Send either a message or a resume value.');
	}

	const doc = await ownedDocument(body.documentId, locals.user.id);
	const model = asModelId(body.model ?? locals.user.defaultModel);
	const effort = asEffort(body.effort ?? locals.user.defaultEffort);
	const activeRun = await ensureRun(doc.id, locals.user.id, model, effort);

	const previous = await latestWorkbook(doc.id);
	const initialWorkbook = (previous?.dataJson as WorkbookModel | undefined) ?? undefined;

	// Aborting the request (the user pressed Stop, or the browser went away)
	// cancels the model call; the checkpoint keeps whatever finished.
	const controller = new AbortController();
	request.signal.addEventListener('abort', () => controller.abort());

	const encoder = new TextEncoder();
	const result: { current?: StreamRunResult } = {};

	const stream = new ReadableStream<Uint8Array>({
		async start(streamController) {
			const send = (event: AgentEvent) => {
				streamController.enqueue(encoder.encode(encodeEvent(event)));
			};

			await setRunStatus(activeRun.id, 'running');

			try {
				for await (const event of streamRun(
					{
						context: {
							documentId: doc.id,
							runId: activeRun.id,
							userId: locals.user!.id,
							filename: doc.originalFilename,
							mimeType: doc.mimeType
						},
						model,
						effort,
						threadId: activeRun.threadId,
						input:
							body.resume !== undefined
								? { resume: body.resume }
								: { messages: [{ role: 'user', content: body.message ?? '' }] },
						signal: controller.signal,
						initialWorkbook
					},
					result
				)) {
					send(event);
				}

				const final = result.current;
				if (final) {
					if (final.workbook.sheets.length) {
						await saveWorkbook(doc.id, activeRun.id, final.workbook, body.message ?? 'Resumed run');
					}
					await addUsage(activeRun.id, final.usage);
					await setRunStatus(activeRun.id, final.status === 'interrupted' ? 'interrupted' : 'done');
				} else {
					await setRunStatus(activeRun.id, 'done');
				}
			} catch (cause) {
				const aborted = controller.signal.aborted || (cause as Error)?.name === 'AbortError';

				// Whatever the agent finished before the failure is still worth
				// keeping — this is the difference between a hiccup and lost work.
				if (result.current?.workbook.sheets.length) {
					await saveWorkbook(
						doc.id,
						activeRun.id,
						result.current.workbook,
						aborted ? 'Stopped by the user' : 'Partial result before an error'
					);
				}

				if (aborted) {
					await setRunStatus(activeRun.id, 'cancelled');
					send({ type: 'done', status: 'cancelled' });
				} else {
					const message = cause instanceof Error ? cause.message : 'The run failed unexpectedly.';
					console.error('[rowbot] run failed', cause);
					await setRunStatus(activeRun.id, 'failed', { errorMessage: message });
					send({ type: 'error', message, recoverable: true });
					send({ type: 'done', status: 'complete' });
				}
			} finally {
				streamController.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			// Stops any intermediary from buffering the stream into one blob.
			'x-accel-buffering': 'no'
		}
	});
};
