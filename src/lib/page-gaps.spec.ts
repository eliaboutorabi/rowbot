import { describe, expect, it } from 'vitest';
import { listNumbers, missingPages } from './page-gaps';

describe('missingPages', () => {
	it('finds nothing when every page has a read', () => {
		expect(missingPages(5, [0, 1, 2, 3, 4])).toEqual([]);
	});

	it('reports a lost first page as page 1', () => {
		expect(missingPages(5, [1, 2, 3, 4])).toEqual([1]);
	});

	it('reports the case that went unnoticed: one page left of four', () => {
		// A real document in the dev database, left this way by a narrower
		// second OCR pass before that was fixed.
		expect(missingPages(4, [2])).toEqual([1, 2, 4]);
	});

	it('reports a gap in the middle, which numbering alone hides', () => {
		expect(missingPages(4, [0, 2, 3])).toEqual([2]);
	});

	it('says nothing when the page count is unknown', () => {
		expect(missingPages(0, [])).toEqual([]);
	});

	it('ignores a stored page beyond the end of the file', () => {
		// Not a gap, and not this function's business to complain about.
		expect(missingPages(2, [0, 1, 7])).toEqual([]);
	});
});

describe('listNumbers', () => {
	it('reads a single number plainly', () => {
		expect(listNumbers([3])).toBe('3');
	});

	it('joins a pair with "and"', () => {
		expect(listNumbers([3, 4])).toBe('3 and 4');
	});

	it('commas the run and keeps "and" for the last', () => {
		expect(listNumbers([1, 2, 4])).toBe('1, 2 and 4');
	});

	it('has nothing to say about an empty list', () => {
		expect(listNumbers([])).toBe('');
	});
});
