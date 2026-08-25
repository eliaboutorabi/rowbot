import { describe, expect, it } from 'vitest';
import { originForRow } from './sheet-source';
import type { Sheet } from '$lib/types/workbook';

const ledger = (): Sheet => ({
	id: 'a',
	name: 'Global Sales Ledger',
	rows: [],
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
		expect(originForRow(ledger(), 5)).toEqual({
			tablePath: '/source/tables/page-2-tbl-0.html',
			pageIndex: 1
		});
	});

	it('points a row deep in the sheet at the page that contributed it', () => {
		// The bug this exists for: the button jumped to page 14 and the label
		// beside it still said page 2.
		expect(originForRow(ledger(), 320)).toEqual({
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
});
