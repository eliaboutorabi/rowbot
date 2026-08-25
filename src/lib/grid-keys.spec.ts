import { describe, expect, it } from 'vitest';
import { nextCell, spanBetween, type Bounds } from './grid-keys';

const bounds: Bounds = { lastRow: 9, lastColumn: 4 };
const at = (row: number, column: number) => ({ row, column });

describe('nextCell', () => {
	it('ignores keys the grid does not own, so they keep bubbling', () => {
		expect(nextCell({ key: 'a' }, at(0, 0), bounds, 5)).toBeNull();
		expect(nextCell({ key: 'Enter' }, at(0, 0), bounds, 5)).toBeNull();
	});

	it('walks one cell at a time', () => {
		expect(nextCell({ key: 'ArrowDown' }, at(3, 2), bounds, 5)).toEqual(at(4, 2));
		expect(nextCell({ key: 'ArrowRight' }, at(3, 2), bounds, 5)).toEqual(at(3, 3));
	});

	it('stops at every edge rather than wrapping', () => {
		expect(nextCell({ key: 'ArrowUp' }, at(0, 0), bounds, 5)).toEqual(at(0, 0));
		expect(nextCell({ key: 'ArrowLeft' }, at(0, 0), bounds, 5)).toEqual(at(0, 0));
		expect(nextCell({ key: 'ArrowDown' }, at(9, 4), bounds, 5)).toEqual(at(9, 4));
		expect(nextCell({ key: 'ArrowRight' }, at(9, 4), bounds, 5)).toEqual(at(9, 4));
	});

	it('jumps to the far edge with the meta key', () => {
		expect(nextCell({ key: 'ArrowDown', jump: true }, at(3, 2), bounds, 5)).toEqual(at(9, 2));
		expect(nextCell({ key: 'ArrowLeft', jump: true }, at(3, 2), bounds, 5)).toEqual(at(3, 0));
	});

	it('sends Home and End along the row, and with meta to the corners', () => {
		expect(nextCell({ key: 'Home' }, at(3, 2), bounds, 5)).toEqual(at(3, 0));
		expect(nextCell({ key: 'End' }, at(3, 2), bounds, 5)).toEqual(at(3, 4));
		expect(nextCell({ key: 'Home', jump: true }, at(3, 2), bounds, 5)).toEqual(at(0, 0));
		expect(nextCell({ key: 'End', jump: true }, at(3, 2), bounds, 5)).toEqual(at(9, 4));
	});

	it('pages by the viewport, clamped', () => {
		expect(nextCell({ key: 'PageDown' }, at(1, 0), bounds, 4)).toEqual(at(5, 0));
		expect(nextCell({ key: 'PageUp' }, at(1, 0), bounds, 4)).toEqual(at(0, 0));
		expect(nextCell({ key: 'PageDown' }, at(8, 0), bounds, 4)).toEqual(at(9, 0));
	});

	it('survives a sheet with a single cell', () => {
		const one: Bounds = { lastRow: 0, lastColumn: 0 };
		expect(nextCell({ key: 'ArrowDown' }, at(0, 0), one, 5)).toEqual(at(0, 0));
		expect(nextCell({ key: 'End', jump: true }, at(0, 0), one, 5)).toEqual(at(0, 0));
	});
});

describe('spanBetween', () => {
	it('is null for a single cell, which `selected` already covers', () => {
		expect(spanBetween(at(2, 2), at(2, 2), 'Ledger')).toBeNull();
	});

	it('normalises a rectangle dragged upwards and to the left', () => {
		const span = spanBetween(at(6, 3), at(2, 1), 'Ledger');
		expect(span).toMatchObject({ kind: 'range', from: at(2, 1), to: at(6, 3) });
	});

	it('writes A1 notation the agent and the composer both read', () => {
		expect(spanBetween(at(1, 1), at(4, 3), 'Ledger')?.raw).toBe('Ledger!B2:D5');
	});

	it('quotes a sheet name with a space in it', () => {
		expect(spanBetween(at(0, 0), at(1, 0), 'Regional Summary')?.raw).toBe(
			"'Regional Summary'!A1:A2"
		);
	});
});
