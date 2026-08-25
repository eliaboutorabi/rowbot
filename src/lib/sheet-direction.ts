/**
 * Which way a sheet reads.
 *
 * A Persian transcript and an English one can sit in the same workbook, and
 * `dir="auto"` on each cell gets the text inside it right. It cannot get the
 * *columns* right: in the source document the first column is the rightmost
 * one, and laying the sheet out left-to-right silently reverses the reading
 * order of the whole table. So direction is decided once per sheet, from what
 * the sheet actually contains, and applied to the grid and to the exported
 * worksheet alike — Excel has the same setting, and a workbook that opens
 * mirrored is not a faithful transcription.
 *
 * Judged on strong characters only. Digits, punctuation and currency symbols
 * are direction-neutral and a table is mostly made of them, so counting them
 * would call almost every sheet left-to-right.
 */
import type { Sheet } from '$lib/types/workbook';

/*
 * Hebrew, Arabic, Syriac, Thaana, NKo and the Arabic/Hebrew presentation
 * forms. Written as escapes: the literal ranges include characters a linter
 * reasonably objects to finding in source, and one of them is a byte-order
 * mark.
 */
const RTL =
	/[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u07C0-\u07FF\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g;
const LTR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/g;

/** How many cells to look at. Enough to be sure, cheap enough to run on render. */
const SAMPLE = 400;

export function isRightToLeft(sheet: Pick<Sheet, 'rows'>): boolean {
	let rtl = 0;
	let ltr = 0;
	let seen = 0;

	for (const row of sheet.rows) {
		for (const cell of row) {
			if (typeof cell.v !== 'string') continue;
			if (seen++ >= SAMPLE) break;
			rtl += cell.v.match(RTL)?.length ?? 0;
			ltr += cell.v.match(LTR)?.length ?? 0;
		}
		if (seen >= SAMPLE) break;
	}

	return rtl > ltr;
}
