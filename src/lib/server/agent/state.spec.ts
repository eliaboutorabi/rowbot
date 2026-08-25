import { describe, expect, it } from 'vitest';
import { mergeOcrIndex, type OcrIndex, type OcrTableIndexEntry } from './state';

const table = (pageIndex: number, id: string): OcrTableIndexEntry => ({
	pageIndex,
	tableId: id,
	path: `/source/tables/page-${pageIndex + 1}-${id}.html`,
	rows: 10,
	columns: 3,
	preview: 'No. | Course | Grade'
});

const index = (over: Partial<OcrIndex> = {}): OcrIndex => ({
	model: 'mistral-ocr-4-1',
	pageCount: 3,
	pagesProcessed: 1,
	tables: [],
	pagesWithoutTables: [],
	averageConfidence: null,
	...over
});

describe('mergeOcrIndex', () => {
	it('takes the first pass as-is', () => {
		const first = index({ tables: [table(0, 'tbl-0')] });
		expect(mergeOcrIndex(null, first)).toBe(first);
	});

	it('unions the tables of two passes over different pages', () => {
		const merged = mergeOcrIndex(
			index({ tables: [table(0, 'tbl-0')], pagesProcessed: 1 }),
			index({ tables: [table(2, 'tbl-0')], pagesProcessed: 3 })
		);

		expect(merged.tables.map((t) => t.pageIndex)).toEqual([0, 2]);
		expect(merged.pagesProcessed).toBe(3);
	});

	it('keeps one copy when the same page is read twice', () => {
		// The failure this reducer exists for: the model issues two identical
		// `ocr_document` calls in one step and a last-value channel aborts the run.
		const twice = index({ tables: [table(0, 'tbl-0'), table(0, 'tbl-1')] });
		const merged = mergeOcrIndex(twice, twice);

		expect(merged.tables).toHaveLength(2);
	});

	it('weights confidence by the pages each pass read', () => {
		const merged = mergeOcrIndex(
			index({ pagesProcessed: 9, averageConfidence: 0.9 }),
			index({ pagesProcessed: 1, averageConfidence: 0.5 })
		);

		expect(merged.averageConfidence).toBeCloseTo(0.86, 5);
	});

	it('drops a page from pagesWithoutTables once a later pass finds one', () => {
		const merged = mergeOcrIndex(
			index({ pagesWithoutTables: [1, 2] }),
			index({ tables: [table(1, 'tbl-0')], pagesWithoutTables: [] })
		);

		expect(merged.pagesWithoutTables).toEqual([2]);
	});
});
