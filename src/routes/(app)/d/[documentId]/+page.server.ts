import type { PageServerLoad } from './$types';
import { latestRun, latestWorkbook, ownedDocument } from '$lib/server/runs';
import { asEffort, asModelId } from '$lib/server/agent/models';
import { readTranscript } from '$lib/server/agent/transcript';
import type { WorkbookModel } from '$lib/types/workbook';

export const load: PageServerLoad = async ({ params, locals }) => {
	// `ownedDocument` raises a 404 for anything this user does not own.
	const doc = await ownedDocument(params.documentId, locals.user!.id);
	const [saved, run] = await Promise.all([latestWorkbook(doc.id), latestRun(doc.id)]);

	// Everything the agent said and did is in the run's checkpoint. Reading it
	// back is what makes reopening a document feel like returning to work
	// rather than starting over.
	const transcript = run ? await readTranscript(run.threadId) : null;

	return {
		document: {
			id: doc.id,
			name: doc.name,
			originalFilename: doc.originalFilename,
			mimeType: doc.mimeType,
			sizeBytes: doc.sizeBytes
		},
		workbook: (saved?.dataJson as WorkbookModel | null) ?? null,
		workbookVersion: saved?.version ?? 0,
		transcript,
		runStatus: run?.status ?? null,
		/**
		 * Start on arrival only for a document nothing has touched yet. Once a run
		 * exists this stays false, so a reload never re-runs the agent — and the
		 * decision lives here rather than in a URL flag the client has to race the
		 * router to clear.
		 */
		autoStart: !run && !saved,
		preferences: {
			model: asModelId(run?.model ?? locals.user!.defaultModel),
			effort: asEffort(run?.effort ?? locals.user!.defaultEffort)
		}
	};
};
