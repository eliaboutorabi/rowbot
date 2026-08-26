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

describe.runIf(live)('irs-schedule-c', () => {
	it('the filled form is read back off the page', async () => {
		const res = await read('irs-schedule-c.pdf');
		// Form-field values live in annotation appearance streams, which is
		// exactly where a filled PDF quietly comes back blank — and tables
		// arrive as separate documents, so the page markdown alone holds
		// only a link to them.
		const text = res.pages
			.flatMap((page) => [page.markdown, ...(page.tables ?? []).map((t) => t.content)])
			.join('\n');

		const expected = [
			// The metadata that ends up on the Details sheet.
			'Dana R. Whitfield',
			'987-65-4321',
			'Alder & Finch Bindery',
			'118 Kilnwood Road',
			'Providence, RI 02909',
			// Comb fields print one digit per box, so they come back spaced —
			// which is what is actually on the paper.
			'3 2 3 1 0 0',
			'9 9 0 4 3 2 1 8 7',
			// Part I.
			'184,250',
			'2,140',
			'182,110',
			'61,480',
			'120,630',
			'1,875',
			'122,505',
			// Part II, both columns.
			'3,420',
			'4,865',
			'7,200',
			'8,940',
			'2,760',
			'1,310',
			'2,150',
			'1,845',
			'3,600',
			'18,000',
			'2,485',
			'5,930',
			'3,275',
			'1,940',
			'610',
			'4,120',
			'21,500',
			'6,435',
			// Part III, and the home-office square footage on line 30.
			'12,300',
			'44,870',
			'6,500',
			'14,210',
			'2,900',
			'80,780',
			'19,300',
			'1,450',
			// Part IV, and one row of Part V.
			'2022',
			'6,240',
			'1,180',
			'3,415',
			'Bookbinding tool',
			'780'
		];
		for (const value of expected) expect(text, value).toContain(value);

		// Known, and worth knowing before you record: Part II is laid out as
		// two columns of line items, and the summary boxes for lines 28-31 sit
		// in the right-hand column's x position under the last of its rows. The
		// reader flattens the two columns into one grid and there is no slot
		// left for them, so total expenses, tentative profit, the home-office
		// deduction and net profit all come back empty.
		//
		// Every input they are computed from does survive, so the agent can put
		// all four back by running the arithmetic. That is the demo.
		for (const lost of ['100,385', '22,120', '1,200', '20,920']) {
			expect(text).not.toContain(lost);
		}
	}, 180_000);
});
