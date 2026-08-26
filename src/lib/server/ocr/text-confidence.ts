/**
 * Confidence for a value the agent typed rather than imported.
 *
 * A Details sheet — supplier, invoice number, terms, bank details — is built
 * from the page text, not from a table, so it goes in through `edit_cells` and
 * arrives with no confidence at all. Every one of those cells then looks as
 * certain as a figure the reader was sure of, on documents where the whole
 * point is that some of it is faint. On the faded Harbour receipt the date came
 * through as "14 March 2016" for a page that says 2026, and nothing about the
 * cell suggested doubt.
 *
 * The page can know, but not at the same time as the table does. Mistral's
 * `confidence_scores_granularity` is a single enum, and the two settings are
 * exclusive — measured against this receipt:
 *
 *   word  → 39 word scores on the table, 0 blocks carrying a score
 *   block → 0 word scores, all 12 blocks carrying a score
 *
 * The reader is asked for `word`, because per-cell confidence on an imported
 * table is the feature this application is built around and a table-wide
 * average would gut it. So today this finds nothing and every typed cell keeps
 * no confidence, which is why the grid says "written, not read" rather than
 * showing a figure it does not have.
 *
 * It is written and wired anyway because the missing half is one option away:
 * a second, `block`-granularity pass over the pages a Details sheet is built
 * from, merged into the stored blocks without disturbing the tables. Then this
 * matches and those cells score like any other. Until then it is a no-op that
 * costs one indexed read per `edit_cells` call.
 */
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { documentPage } from '$lib/server/db/schema';
import { normalise } from '$lib/cell-locate';
import type { OcrBlock } from './mistral';

export interface TextSource {
	/** The block's text, normalised for comparison. */
	needle: string;
	confidence: number;
}

/** Every text block of a document that carries a confidence, normalised. */
export async function pageTextSources(documentId: string): Promise<TextSource[]> {
	const rows = await db
		.select({ blocks: documentPage.blocksJson })
		.from(documentPage)
		.where(eq(documentPage.documentId, documentId));

	const sources: TextSource[] = [];
	for (const row of rows) {
		for (const block of (row.blocks ?? []) as OcrBlock[]) {
			// Tables have their own per-word scores and their cells are imported,
			// not typed; this is only for the prose around them.
			if (block.type === 'table') continue;

			const confidence = block.confidence_scores?.average_confidence_score;
			const needle = normalise(block.content ?? '');
			if (typeof confidence !== 'number' || needle.length < 2) continue;

			sources.push({ needle, confidence });
		}
	}
	return sources;
}

/**
 * The confidence of the block a value was transcribed from.
 *
 * Where a value appears in more than one block the lowest wins, on the same
 * principle the table importer uses: a figure is only as trustworthy as the
 * worst reading behind it.
 */
export function confidenceForValue(
	sources: readonly TextSource[],
	value: unknown
): number | undefined {
	if (value === null || value === undefined) return undefined;

	const wanted = normalise(String(value));
	// Two characters can be found inside anything; matching those would attach a
	// confidence that means nothing.
	if (wanted.length < 3) return undefined;

	let worst: number | undefined;
	for (const source of sources) {
		if (!source.needle.includes(wanted)) continue;
		if (worst === undefined || source.confidence < worst) worst = source.confidence;
	}
	return worst;
}
