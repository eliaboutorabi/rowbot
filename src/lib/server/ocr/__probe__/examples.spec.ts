/**
 * Checks the demo fixtures against the model rather than against how bad they
 * look to a person.
 *
 * A scan built to be hard is only hard if the reader agrees, and the two are
 * easy to get wrong in both directions: a stain that swallows a figure can be
 * reconstructed confidently from context, and a page that looks fine to us can
 * come back full of doubt. So the file whose job is to produce low confidence
 * is asserted to produce it, and the file whose job is to read cleanly is
 * asserted to read cleanly.
 *
 *   ROWBOT_LIVE=1 npx vitest run src/lib/server/ocr/__probe__/examples.spec.ts
 *
 * Skipped by default: it calls the real API and is billed per page.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runOcr, type OcrResponse } from '../mistral';
import { parseTableHtml } from '../html-table';

const live = process.env.ROWBOT_LIVE === '1';

/** Where the demo set lives. Not in the repo: these are recording props. */
const DIR = process.env.ROWBOT_EXAMPLES ?? join(homedir(), 'Downloads', 'examples');

const MIME: Record<string, string> = {
	'.pdf': 'application/pdf',
	'.jpg': 'image/jpeg',
	'.png': 'image/png'
};

/** Every scored cell in the response, flattened, so a run can be asserted on. */
function scoredCells(res: OcrResponse) {
	const cells = [];
	for (const page of res.pages) {
		for (const table of page.tables ?? []) {
			const parsed = parseTableHtml(table.content, {
				wordConfidences: table.word_confidence_scores ?? []
			});
			for (const row of parsed.rows) {
				for (const cell of row) {
					if (cell.conf !== undefined) cells.push(cell);
				}
			}
		}
	}
	return cells;
}

async function read(name: string) {
	const bytes = new Uint8Array(readFileSync(join(DIR, name)));
	const res = await runOcr(bytes, MIME[name.slice(name.lastIndexOf('.'))], name);

	console.log(`\n${'='.repeat(60)}\n${name}\n${'='.repeat(60)}`);
	for (const page of res.pages) {
		const c = page.confidence_scores;
		console.log(
			`page ${page.index}  avg ${c?.average_page_confidence_score?.toFixed(3)}  min ${c?.minimum_page_confidence_score?.toFixed(3)}`
		);
		for (const table of page.tables ?? []) {
			const parsed = parseTableHtml(table.content, {
				wordConfidences: table.word_confidence_scores ?? []
			});
			console.log(`  ${table.id}  ${parsed.rows.length} x ${parsed.width}`);
			for (const row of parsed.rows) {
				const line = row.map((cell) => {
					const text = String(cell.raw ?? cell.v ?? '')
						.padEnd(18)
						.slice(0, 18);
					const pct = cell.conf === undefined ? '--' : `${(cell.conf * 100).toFixed(1)}%`;
					return `${text} ${pct.padStart(6)}`;
				});
				console.log(`    ${line.join(' | ')}`);
			}
		}
	}
	return res;
}

describe.runIf(live)('demo fixtures', () => {
	it('the damaged receipt leaves the reader unsure of at least two cells', async () => {
		const cells = scoredCells(await read('harbour-receipt-damaged.jpg'));
		// The whole point of the file. Two obscured figures, both misread,
		// both flagged — which is what the arithmetic check then catches.
		expect(cells.filter((cell) => (cell.conf ?? 1) < 0.95).length).toBeGreaterThanOrEqual(2);
	}, 120_000);

	it('the plain scan reads cleanly, so the two are a contrast', async () => {
		const cells = scoredCells(await read('harbour-receipt-scanned.jpg'));
		expect(cells.length).toBeGreaterThan(20);
		expect(cells.filter((cell) => (cell.conf ?? 1) < 0.95)).toHaveLength(0);
	}, 120_000);
});
