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
