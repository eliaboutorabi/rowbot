import { describe, expect, it } from 'vitest';
import { isRightToLeft } from './sheet-direction';

const sheet = (rows: (string | number | null)[][]) => ({
	rows: rows.map((row) =>
		row.map((v) => ({ v, t: typeof v === 'number' ? ('number' as const) : ('text' as const) }))
	)
});

describe('isRightToLeft', () => {
	it('reads a Persian table right to left', () => {
		expect(
			isRightToLeft(
				sheet([
					['ردیف', 'شماره درس', 'نام درس', 'تعداد واحد'],
					[1, 7064, 'اقتصاد خرد', 3],
					[2, 7066, 'اصول تنظیم و کنترل بودجه', 2]
				])
			)
		).toBe(true);
	});

	it('reads an English table left to right', () => {
		expect(
			isRightToLeft(
				sheet([
					['No.', 'Course Code', 'Course Title', 'Credit'],
					[1, 7064, 'Economics I (Micro)', 3]
				])
			)
		).toBe(false);
	});

	it('is not swayed by the digits, which are most of a table', () => {
		// A ledger of figures with two Persian words in it is still a Persian
		// sheet; a table of numbers with English headers is still English.
		expect(isRightToLeft(sheet([['نام درس'], [1234567], [8901234], [5678901]]))).toBe(true);
	});

	it('does as the reviewer says, whatever the characters suggest', () => {
		// The reader returns an RTL table's columns in logical order for some
		// documents and visual order for others, so the guess cannot always be
		// right — and a mirrored table is worse than an unflipped one.
		const persian = sheet([['نام درس'], ['اقتصاد خرد']]);

		expect(isRightToLeft(persian)).toBe(true);
		expect(isRightToLeft({ ...persian, direction: 'ltr' })).toBe(false);

		const english = sheet([['Course'], ['Economics']]);
		expect(isRightToLeft({ ...english, direction: 'rtl' })).toBe(true);
	});

	it('calls a sheet with nothing to go on left to right', () => {
		expect(
			isRightToLeft(
				sheet([
					[1, 2],
					[3, 4]
				])
			)
		).toBe(false);
	});
});
