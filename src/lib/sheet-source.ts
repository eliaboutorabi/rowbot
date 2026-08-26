/**
 * Which block on which page a row of a sheet came from.
 *
 * A sheet stitched from seventeen OCR tables has seventeen answers to "where
 * did this come from?", and the right one depends on which row you are
 * standing on. Both directions of the crossing need it — the button that jumps
 * to the page, and the label on that button naming where it will land — so it
 * lives here rather than in either of them. A label that says page 2 while the
 * button goes to page 14 is worse than no label.
 */
import type { Sheet } from '$lib/types/workbook';

export interface SheetOrigin {
	/** Path of the OCR table in the agent's workspace. */
	tablePath: string;
	/** Zero-based page it sits on, when the path records one. */
	pageIndex?: number;
	/**
	 * Where the row sits inside *that page's* table, and how many rows that
	 * table has — which is not the same as its place in the sheet, because a
	 * stitched sheet runs the pages end to end.
	 *
	 * Used to narrow a highlight on the page down to a line. Counts the header
	 * row a continuation page reprints and the importer drops, so the numbers
	 * describe the paper rather than the sheet.
	 */
	rowInTable?: number;
	rowsInTable?: number;
}

/** `/source/tables/page-14-tbl-0.html` → 13 */
function pageOf(path: string): number | undefined {
	const match = /page-(\d+)-/.exec(path);
	return match ? Number(match[1]) - 1 : undefined;
}

export function originForRow(sheet: Sheet, row: number | undefined): SheetOrigin | null {
	const first = sheet.source?.tablePath;
	if (!first) return null;

	let path = first;
	let pageIndex = sheet.source?.pageIndex;
	/** Row of the sheet at which the chosen page's contribution begins. */
	let from = 0;
	/** Row of the sheet at which the next page takes over. */
	let until = sheet.rows.length;
	let reprintsHeader = false;

	const starts = sheet.continuedAt ?? [];
	if (row !== undefined) {
		if (starts.length) until = starts[0];
		for (let i = 0; i < starts.length; i++) {
			const continued = sheet.continuedFrom?.[i];
			if (continued && row >= starts[i]) {
				path = continued;
				pageIndex = pageOf(continued);
				from = starts[i];
				until = starts[i + 1] ?? sheet.rows.length;
				// The first page's header is in the sheet; a continuation's was
				// dropped on import but is still printed on the paper.
				reprintsHeader = true;
			}
		}
	}

	const origin: SheetOrigin = { tablePath: path, pageIndex };

	if (row !== undefined && sheet.rows.length) {
		const header = reprintsHeader ? sheet.headerRows : 0;
		origin.rowInTable = row - from + header;
		origin.rowsInTable = until - from + header;
	}

	return origin;
}
