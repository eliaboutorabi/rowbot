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

	const starts = sheet.continuedAt ?? [];
	if (row !== undefined) {
		for (let i = 0; i < starts.length; i++) {
			const continued = sheet.continuedFrom?.[i];
			if (continued && row >= starts[i]) {
				path = continued;
				pageIndex = pageOf(continued);
			}
		}
	}

	return { tablePath: path, pageIndex };
}
