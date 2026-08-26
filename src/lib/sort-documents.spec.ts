import { describe, expect, it } from 'vitest';
import { isSortKey, lastTouched, sortDocuments, type Sortable } from './sort-documents';

const doc = (
	name: string,
	createdAt: string,
	lastActiveAt?: string,
	title?: string | null
): Sortable & { name: string } => ({
	name,
	title: title ?? null,
	createdAt,
	conversation: lastActiveAt ? { lastActiveAt } : null
});

const LIBRARY = [
	doc('ashfield', '2026-01-10', '2026-03-01'),
	doc('Calder', '2026-02-20'), // never opened
	doc('bilingual', '2026-01-05', '2026-04-15'),
	doc('Ledger', '2026-03-30', '2026-03-31')
];

const names = (list: readonly { name: string }[]) => list.map((d) => d.name);

describe('sortDocuments', () => {
	it('puts the newest arrival first by date added', () => {
		expect(names(sortDocuments(LIBRARY, 'added'))).toEqual([
			'Ledger',
			'Calder',
			'ashfield',
			'bilingual'
		]);
	});

	it('puts the most recently worked on first, which is a different order', () => {
		expect(names(sortDocuments(LIBRARY, 'modified'))).toEqual([
			'bilingual',
			'Ledger',
			'ashfield',
			'Calder'
		]);
	});

	it('sorts by name without the capitals coming first', () => {
		expect(names(sortDocuments(LIBRARY, 'name'))).toEqual([
			'ashfield',
			'bilingual',
			'Calder',
			'Ledger'
		]);
	});

	it('sorts by the name the library actually shows, not the filename', () => {
		const list = [doc('zzz-scan.pdf', '2026-01-01', undefined, 'Alpha Holdings')];
		list.push(doc('aaa-scan.pdf', '2026-01-01', undefined, 'Zenith Ltd'));
		expect(sortDocuments(list, 'name').map((d) => d.title)).toEqual([
			'Alpha Holdings',
			'Zenith Ltd'
		]);
	});

	it('orders numbers in a name the way a person reads them', () => {
		const list = [doc('Report 10', '2026-01-01'), doc('Report 2', '2026-01-01')];
		expect(names(sortDocuments(list, 'name'))).toEqual(['Report 2', 'Report 10']);
	});

	it('never reorders the list it was given', () => {
		const original = [...LIBRARY];
		sortDocuments(LIBRARY, 'name');
		expect(LIBRARY).toEqual(original);
	});

	it('copes with an empty library', () => {
		expect(sortDocuments([], 'modified')).toEqual([]);
	});
});

describe('lastTouched', () => {
	it('uses the conversation when there is one', () => {
		expect(lastTouched(doc('a', '2026-01-01', '2026-05-05'))).toBe(
			new Date('2026-05-05').getTime()
		);
	});

	it('falls back to when the file arrived, not to the epoch', () => {
		// The bug this guards: an untouched project sorting as though it were
		// from 1970 and sinking to the bottom of "last worked on" forever.
		expect(lastTouched(doc('a', '2026-01-01'))).toBe(new Date('2026-01-01').getTime());
	});
});

describe('isSortKey', () => {
	it('accepts the three it knows', () => {
		expect(['added', 'modified', 'name'].every(isSortKey)).toBe(true);
	});

	it('rejects anything else, so a stale stored value cannot break the grid', () => {
		expect(isSortKey('size')).toBe(false);
		expect(isSortKey(null)).toBe(false);
	});
});
