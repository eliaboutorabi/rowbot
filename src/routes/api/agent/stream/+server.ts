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
import { assertCanRun, countTurn, resolveKeys } from '$lib/server/entitlements';
import { withProviderKeys } from '$lib/server/provider-keys';

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

/**
 * What a turn is called in the workbook's history.
 *
 * The request itself, because that is the handle you would recognise it by —
 * but a sentence of it, not a paragraph. The whole prompt made every row of
 * the history the same wall of text, which is the same as having no summaries
 * at all.
 */
function turnSummary(message: string | undefined): string {
	const text = message?.trim();
	if (!text) return 'Picked the run back up';
	const firstLine = text.split('\n').find((line) => line.trim()) ?? text;
	return firstLine.length > 90 ? `${firstLine.slice(0, 87).trimEnd()}…` : firstLine;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Sign in first.');

	const body = (await request.json()) as Body;
	if (!body.documentId) error(400, 'Which document?');
	if (body.message === undefined && body.resume === undefined) {
		error(400, 'Send either a message or a resume value.');
	}

	const doc = await ownedDocument(body.documentId, locals.user.id);

	// Two separate questions, in order: is this account allowed another turn,
	// and whose credit does the turn spend? A `byok` account passes the first
	// trivially, because it is paying for itself.
	await assertCanRun(locals.user);
	const keys = await resolveKeys(locals.user);

	const model = asModelId(body.model ?? locals.user.defaultModel);
	const effort = asEffort(body.effort ?? locals.user.defaultEffort);
	const activeRun = await ensureRun(doc.id, locals.user.id, model, effort);
	await countTurn(activeRun.id);

	const previous = await latestWorkbook(doc.id);
	const initialWorkbook = (previous?.dataJson as WorkbookModel | undefined) ?? undefined;

	// Aborting the request (the user pressed Stop, or the browser went away)
	// cancels the model call; the checkpoint keeps whatever finished.
	const controller = new AbortController();
	request.signal.addEventListener('abort', () => controller.abort());

	// A reader that goes away should stop the model call, not leave it running
	// to completion against a stream nobody is listening to.
	const onCancel = () => {
		gone = true;
		controller.abort();
	};

	const encoder = new TextEncoder();
	const result: { current?: StreamRunResult } = {};

	// `start` runs synchronously inside the constructor, so building the stream
	// inside this scope is what puts the keys in scope for the whole run.
	/**
	 * Set once the consumer has gone — a closed tab, a navigation, a reload.
	 * Without this, every write after the disconnect throws
	 * `Invalid state: Controller is already closed`, which surfaces from inside
	 * the catch block and reports a perfectly healthy run as failed.
	 */
	let gone = false;

	const stream = withProviderKeys(
		keys,
		() =>
			new ReadableStream<Uint8Array>({
				async start(streamController) {
					const send = (event: AgentEvent) => {
						if (gone) return;
						try {
							streamController.enqueue(encoder.encode(encodeEvent(event)));
						} catch {
							// The reader vanished between the check and the write.
							gone = true;
						}
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
							if (final.revision > 0 && final.workbook.sheets.length) {
								await saveWorkbook(doc.id, activeRun.id, final.workbook, turnSummary(body.message));
							}
							await addUsage(activeRun.id, final.usage);
							await setRunStatus(
								activeRun.id,
								final.status === 'interrupted' ? 'interrupted' : 'done'
							);
						} else {
							await setRunStatus(activeRun.id, 'done');
						}
					} catch (cause) {
						const aborted =
							gone || controller.signal.aborted || (cause as Error)?.name === 'AbortError';

						// Whatever the agent finished before the failure is still worth
						// keeping — this is the difference between a hiccup and lost work.
						if (result.current?.revision && result.current.workbook.sheets.length) {
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
							const message =
								cause instanceof Error ? cause.message : 'The run failed unexpectedly.';
							console.error('[rowbot] run failed', cause);
							await setRunStatus(activeRun.id, 'failed', { errorMessage: message });
							send({ type: 'error', message, recoverable: true });
							send({ type: 'done', status: 'complete' });
						}
					} finally {
						try {
							if (!gone) streamController.close();
						} catch {
							// Already closed by the disconnect; nothing to do.
						}
					}
				},
				cancel: onCancel
			})
	);

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
