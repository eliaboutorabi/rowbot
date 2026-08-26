import { describe, expect, it } from 'vitest';
import { originForRow } from './sheet-source';
import type { Sheet } from '$lib/types/workbook';

const ledger = (): Sheet => ({
	id: 'a',
	name: 'Global Sales Ledger',
	rows: Array.from({ length: 340 }, () => []),
	columns: [],
	headerRows: 1,
	source: { pageIndex: 1, tablePath: '/source/tables/page-2-tbl-0.html' },
	continuedFrom: [
		'/source/tables/page-3-tbl-0.html',
		'/source/tables/page-4-tbl-0.html',
		'/source/tables/page-14-tbl-0.html'
	],
	continuedAt: [27, 53, 313]
});

describe('originForRow', () => {
	it('points a row from the first page at the first page', () => {
		expect(originForRow(ledger(), 5)).toMatchObject({
			tablePath: '/source/tables/page-2-tbl-0.html',
			pageIndex: 1
		});
	});

	it('points a row deep in the sheet at the page that contributed it', () => {
		// The bug this exists for: the button jumped to page 14 and the label
		// beside it still said page 2.
		expect(originForRow(ledger(), 320)).toMatchObject({
			tablePath: '/source/tables/page-14-tbl-0.html',
			pageIndex: 13
		});
	});

	it('takes the last continuation that starts at or before the row', () => {
		expect(originForRow(ledger(), 53)?.pageIndex).toBe(3);
		expect(originForRow(ledger(), 52)?.pageIndex).toBe(2);
	});

	it('falls back to the first page when no row is selected', () => {
		expect(originForRow(ledger(), undefined)?.pageIndex).toBe(1);
	});

	it('has nothing to offer a sheet that came from no table', () => {
		expect(originForRow({ ...ledger(), source: undefined }, 5)).toBeNull();
	});

	it('places a row inside its own page, not inside the sheet', () => {
		// Row 5 is on the first page, which contributes rows 0-26.
		expect(originForRow(ledger(), 5)).toMatchObject({ rowInTable: 5, rowsInTable: 27 });
	});

	it('counts from the top of a continuation page, not the top of the sheet', () => {
		// Row 30 is the fourth row of the page that starts at 27 — plus the
		// header that page reprints and the importer dropped.
		expect(originForRow(ledger(), 30)).toMatchObject({ rowInTable: 4, rowsInTable: 27 });
	});

	it('sizes the last page by what is left of the sheet', () => {
		expect(originForRow(ledger(), 320)).toMatchObject({
			rowInTable: 8,
			rowsInTable: 340 - 313 + 1
		});
	});
});
