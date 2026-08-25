import { describe, expect, it } from 'vitest';
import { secondaryName } from './format';

describe('secondaryName', () => {
	it('keeps a filename that says something the title does not', () => {
		expect(secondaryName('Meridian Group — Global Sales Ledger FY2025', 'huge-ledger')).toBe(
			'huge-ledger'
		);
		expect(secondaryName('Ashfield Trading Receivables', 'ambiguous-dates')).toBe(
			'ambiguous-dates'
		);
	});

	it('drops a filename that is the title with different punctuation', () => {
		// The case that made the second line look like a broken copy of the first.
		expect(
			secondaryName('Elham Aboutorabi Diploma Transcript', 'Elham Aboutorabi Diploma-transcript')
		).toBeNull();
	});

	it('drops a filename the title merely extends', () => {
		expect(secondaryName('Calder Partners FY2025 Regional Revenue', 'calder-partners')).toBeNull();
		expect(secondaryName('Receivables', 'Receivables (final) 2025')).toBeNull();
	});

	it('has nothing to add when there is no title', () => {
		expect(secondaryName(null, 'huge-ledger')).toBeNull();
	});

	it('keeps the filename when a title is only punctuation', () => {
		expect(secondaryName('—', 'huge-ledger')).toBe('huge-ledger');
	});
});
