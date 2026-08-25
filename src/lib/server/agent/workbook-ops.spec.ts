import { describe, expect, it } from 'vitest';
import { applyOp, applyOps, describeOp, emptyModel, type WorkbookOp } from './workbook-ops';
import { blankCell, type Sheet } from '$lib/types/workbook';

const sheet = (id: string, name: string): Sheet => ({
	id,
	name,
	rows: [
		[
			{ v: 'Region', t: 'text' },
			{ v: 'Q1', t: 'text' }
		],
		[
			{ v: 'EMEA', t: 'text' },
			{ v: 100, t: 'number' }
		]
	],
	columns: [{ label: 'Region' }, { label: 'Q1' }],
	headerRows: 1
});

describe('workbook operations', () => {
	it('appends sheets in order', () => {
		const wb = applyOps(emptyModel(), [
			{ op: 'addSheet', sheet: sheet('a', 'Revenue') },
			{ op: 'addSheet', sheet: sheet('b', 'Headcount') }
		]);
		expect(wb.sheets.map((s) => s.name)).toEqual(['Revenue', 'Headcount']);
	});

	it('de-duplicates names chosen concurrently, because Excel rejects them', () => {
		// Both calls saw the same pre-step workbook and picked the same name.
		const wb = applyOps(emptyModel(), [
			{ op: 'addSheet', sheet: sheet('a', 'Revenue') },
			{ op: 'addSheet', sheet: sheet('b', 'Revenue') }
		]);
		expect(wb.sheets.map((s) => s.name)).toEqual(['Revenue', 'Revenue 2']);
	});

	it('edits cells by sheet id without disturbing the rest', () => {
		let wb = applyOp(emptyModel(), { op: 'addSheet', sheet: sheet('a', 'Revenue') });
		wb = applyOp(wb, {
			op: 'editCells',
			id: 'a',
			edits: [{ row: 1, column: 1, cell: { v: 250, t: 'number' } }]
		});
		expect(wb.sheets[0].rows[1][1].v).toBe(250);
		expect(wb.sheets[0].rows[1][0].v).toBe('EMEA');
	});

	it('ignores edits pointing outside the sheet', () => {
		let wb = applyOp(emptyModel(), { op: 'addSheet', sheet: sheet('a', 'Revenue') });
		wb = applyOp(wb, {
			op: 'editCells',
			id: 'a',
			edits: [{ row: 99, column: 0, cell: blankCell() }]
		});
		expect(wb.sheets[0].rows).toHaveLength(2);
	});

	it('renames without colliding with a sibling', () => {
		let wb = applyOps(emptyModel(), [
			{ op: 'addSheet', sheet: sheet('a', 'Revenue') },
			{ op: 'addSheet', sheet: sheet('b', 'Headcount') }
		]);
		wb = applyOp(wb, { op: 'updateSheet', id: 'b', patch: { name: 'Revenue' } });
		expect(wb.sheets.map((s) => s.name)).toEqual(['Revenue', 'Revenue 2']);
	});

	it('removes a sheet', () => {
		let wb = applyOps(emptyModel(), [
			{ op: 'addSheet', sheet: sheet('a', 'Revenue') },
			{ op: 'addSheet', sheet: sheet('b', 'Headcount') }
		]);
		wb = applyOp(wb, { op: 'removeSheet', id: 'a' });
		expect(wb.sheets.map((s) => s.name)).toEqual(['Headcount']);
	});

	it('reorders by name and sets the title', () => {
		let wb = applyOps(emptyModel(), [
			{ op: 'addSheet', sheet: sheet('a', 'Revenue') },
			{ op: 'addSheet', sheet: sheet('b', 'Headcount') }
		]);
		wb = applyOp(wb, { op: 'setMeta', title: 'FY25', order: ['Headcount', 'Revenue'] });
		expect(wb.title).toBe('FY25');
		expect(wb.sheets.map((s) => s.name)).toEqual(['Headcount', 'Revenue']);
	});

	it('leaves an unknown sheet id alone rather than throwing', () => {
		const wb = applyOp(emptyModel(), { op: 'removeSheet', id: 'nope' });
		expect(wb.sheets).toEqual([]);
	});

	it('accepts a whole workbook as a seed value', () => {
		// Resuming a thread, or handing state to a subagent, passes a model
		// rather than an op list.
		const seeded = { title: 'Seeded', sheets: [sheet('a', 'Revenue')] };
		expect(applyOps(emptyModel(), seeded).title).toBe('Seeded');
	});

	it('survives a null or malformed update', () => {
		const wb = { title: 'Kept', sheets: [] };
		expect(applyOps(wb, null as never)).toBe(wb);
		expect(applyOps(wb, 'nonsense' as never)).toBe(wb);
	});

	describe('dropColumns', () => {
		const wide = (): Sheet => ({
			id: 'a',
			name: 'Open Items',
			headerRows: 1,
			columns: [{ label: 'Line' }, { label: 'Invoice' }, { label: 'Net' }],
			rows: [
				[
					{ v: 'Line', t: 'text' },
					{ v: 'Invoice', t: 'text' },
					{ v: 'Net', t: 'text' }
				],
				[
					{ v: '001', t: 'text' },
					{ v: 'SI-4201', t: 'text' },
					{ v: 240, t: 'number' }
				]
			]
		});

		it('removes the column and closes the rows up behind it', () => {
			const next = applyOps({ title: 'S', sheets: [wide()] }, [
				{ op: 'dropColumns', id: 'a', columns: [0] }
			]);

			expect(next.sheets[0].columns.map((c) => c.label)).toEqual(['Invoice', 'Net']);
			expect(next.sheets[0].rows[1].map((c) => c.v)).toEqual(['SI-4201', 240]);
		});

		it('shrinks a merge that spanned the column it lost', () => {
			// A span left claiming more columns than the row has is a cell running
			// off the end of the grid, and a file Excel will not open.
			const sheet = wide();
			sheet.rows[0] = [
				{ v: 'Heading', t: 'text', merge: { rs: 1, cs: 3 } },
				{ v: null, t: 'blank', covered: true },
				{ v: null, t: 'blank', covered: true }
			];

			const next = applyOps({ title: 'S', sheets: [sheet] }, [
				{ op: 'dropColumns', id: 'a', columns: [1] }
			]);

			expect(next.sheets[0].rows[0][0].merge?.cs).toBe(2);
		});

		it('drops a merge entirely once it covers one cell', () => {
			const sheet = wide();
			sheet.rows[0] = [
				{ v: 'Pair', t: 'text', merge: { rs: 1, cs: 2 } },
				{ v: null, t: 'blank', covered: true },
				{ v: 'Net', t: 'text' }
			];

			const next = applyOps({ title: 'S', sheets: [sheet] }, [
				{ op: 'dropColumns', id: 'a', columns: [1] }
			]);

			expect(next.sheets[0].rows[0][0].merge).toBeUndefined();
		});

		it('refuses to empty the sheet, and ignores indices that are not there', () => {
			const untouched = applyOps({ title: 'S', sheets: [wide()] }, [
				{ op: 'dropColumns', id: 'a', columns: [0, 1, 2] }
			]);
			expect(untouched.sheets[0].columns).toHaveLength(3);

			const ignored = applyOps({ title: 'S', sheets: [wide()] }, [
				{ op: 'dropColumns', id: 'a', columns: [9] }
			]);
			expect(ignored.sheets[0].columns).toHaveLength(3);
		});

		it('pulls a frozen column count back inside the sheet', () => {
			const sheet = { ...wide(), freeze: { rows: 1, cols: 3 } };
			const next = applyOps({ title: 'S', sheets: [sheet] }, [
				{ op: 'dropColumns', id: 'a', columns: [0] }
			]);

			expect(next.sheets[0].freeze?.cols).toBe(2);
		});
	});

	describe('appendRows — a table that continues over a page break', () => {
		const cells = (region: string, value: number) => [
			{ v: region, t: 'text' as const },
			{ v: value, t: 'number' as const }
		];

		it('extends the sheet instead of creating a second one', () => {
			const wb = { title: 'Ledger', sheets: [sheet('a', 'Ledger')] };
			const next = applyOps(wb, [
				{ op: 'appendRows', id: 'a', rows: [cells('APAC', 200), cells('LATAM', 300)] }
			]);

			expect(next.sheets).toHaveLength(1);
			expect(next.sheets[0].rows).toHaveLength(4);
			// Header, then the original row, then the continuation, in order.
			expect(next.sheets[0].rows.map((row) => row[0].v)).toEqual([
				'Region',
				'EMEA',
				'APAC',
				'LATAM'
			]);
			expect(next.sheets[0].headerRows).toBe(1);
		});

		it('records where each continuation came from', () => {
			const wb = { title: 'Ledger', sheets: [sheet('a', 'Ledger')] };
			const next = applyOps(wb, [
				{
					op: 'appendRows',
					id: 'a',
					rows: [cells('APAC', 200)],
					sourcePath: '/source/tables/page-3-tbl-1.html'
				},
				{
					op: 'appendRows',
					id: 'a',
					rows: [cells('LATAM', 300)],
					sourcePath: '/source/tables/page-4-tbl-2.html'
				}
			]);

			expect(next.sheets[0].continuedFrom).toEqual([
				'/source/tables/page-3-tbl-1.html',
				'/source/tables/page-4-tbl-2.html'
			]);
			// Where, as well as which: clicking the page-4 block in the source
			// overlay has to land on the rows page 4 contributed, not on row 1 of
			// the sheet the first page made.
			expect(next.sheets[0].continuedAt).toEqual([
				sheet('a', 'Ledger').rows.length,
				sheet('a', 'Ledger').rows.length + 1
			]);
		});

		it('keeps the sheet rectangular when a continuation page is short a column', () => {
			// OCR drops a trailing empty column often enough that a ragged append
			// would otherwise corrupt every row index after it.
			const wb = { title: 'Ledger', sheets: [sheet('a', 'Ledger')] };
			const next = applyOps(wb, [{ op: 'appendRows', id: 'a', rows: [[{ v: 'MEA', t: 'text' }]] }]);

			expect(next.sheets[0].rows.at(-1)).toHaveLength(2);
			expect(next.sheets[0].rows.at(-1)![1].v).toBeNull();
		});

		it('is a no-op against an unknown sheet, and for no rows', () => {
			const wb = { title: 'Ledger', sheets: [sheet('a', 'Ledger')] };
			expect(applyOps(wb, [{ op: 'appendRows', id: 'missing', rows: [cells('X', 1)] }])).toEqual(
				wb
			);
			expect(applyOps(wb, [{ op: 'appendRows', id: 'a', rows: [] }]).sheets[0].rows).toHaveLength(
				2
			);
		});

		it('describes itself for the revision rail', () => {
			const wb = { title: 'x', sheets: [sheet('a', 'Ledger')] };
			expect(
				describeOp({ op: 'appendRows', id: 'a', rows: [cells('X', 1), cells('Y', 2)] }, wb)
			).toBe('Added 2 rows to “Ledger”');
		});
	});

	it('describes each op for the revision rail', () => {
		const wb = { title: 'x', sheets: [sheet('a', 'Revenue')] };
		const ops: WorkbookOp[] = [
			{ op: 'addSheet', sheet: sheet('b', 'Headcount') },
			{ op: 'editCells', id: 'a', edits: [{ row: 1, column: 1, cell: blankCell() }] },
			{ op: 'removeSheet', id: 'a' }
		];
		expect(ops.map((o) => describeOp(o, wb))).toEqual([
			'Added “Headcount”',
			'Corrected 1 cell in “Revenue”',
			'Removed “Revenue”'
		]);
	});
});
