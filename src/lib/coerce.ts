/**
 * Turning OCR text into typed spreadsheet values.
 *
 * This runs on the server when a table is first parsed and again in the
 * browser when a reviewer edits a cell, so it lives outside `$lib/server`.
 * Everything here is a *suggestion* — the agent can override any cell's type
 * via `write_sheet`, and the reviewer can override the agent.
 */
import type { Cell, CellType } from '$lib/types/workbook';

export interface Coerced {
	v: string | number | boolean | null;
	t: CellType;
	fmt?: string;
}

/** Values that mean "nothing here" in a scanned table. */
const BLANKS = new Set(['', '-', '--', '—', '–', 'n/a', 'na', 'n.a.', 'null', 'nil', '.', '#n/a']);
const TRUES = new Set(['true', 'yes', 'y', '✓', '✔', 'x']);
const FALSES = new Set(['false', 'no', 'n', '✗', '✘']);

/** Leading currency markers, longest-first so `CHF` wins over `C`. */
const CURRENCY_PREFIXES = [
	'USD',
	'EUR',
	'GBP',
	'JPY',
	'CHF',
	'CAD',
	'AUD',
	'R$',
	'$',
	'€',
	'£',
	'¥',
	'₹',
	'₽',
	'₩',
	'฿',
	'₪'
];
const CURRENCY_RE = new RegExp(
	`^(?:${CURRENCY_PREFIXES.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*`,
	'i'
);
const CURRENCY_GLYPH_RE = /[$€£¥₹₽₩฿₪]/;

/** Strips footnote markers, whitespace oddities and zero-width junk. */
export function cleanText(input: string): string {
	return (
		input
			// Non-breaking and narrow no-break spaces become ordinary spaces.
			.replace(/[\u00a0\u202f\u2007]/g, ' ')
			// Zero-width space, ZWNJ, ZWJ and the byte-order mark carry no meaning
			// here but break every comparison they appear in. Listed as
			// alternatives rather than a character class: ZWNJ and ZWJ sitting
			// side by side in a class reads as a joined sequence.
			.replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

/*
 * Arabic-Indic (٠-٩) and Eastern Arabic-Indic, or Persian, digits (۰-۹).
 *
 * A transcript printed in Tehran is full of figures; they are simply not
 * written with the glyphs `Number()` understands, so every grade on it came
 * through as text. A text column cannot be summed, cannot carry a formula,
 * cannot be reconciled against a printed total, and is not even right-aligned
 * — which is a poor showing for a workbook whose whole promise is the figures.
 *
 * The folding happens here rather than in `cleanText`, so the cell's `raw`
 * still holds what the page actually said and the inspector can show it.
 */
const EASTERN_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/;

function foldEasternDigits(input: string): string {
	return (
		input
			.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
			.replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
			// The Arabic decimal separator, thousands separator and percent sign.
			// Unambiguous, unlike the slash that Persian typesetting also uses for
			// a decimal point — `۱۵/۲۵` is 15.25 and `۸۸/۸۹` is an academic year,
			// and nothing in the cell itself says which. That one is left as text
			// for the agent to judge with the page in front of it.
			.replace(/\u066b/g, '.')
			.replace(/\u066c/g, ',')
			.replace(/\u066a/g, '%')
	);
}

export interface NumericAnalysis {
	value: number;
	/** Digits after the decimal separator, used to pick a number format. */
	decimals: number;
	/** Whether the source used thousands separators, e.g. `1,234`. */
	grouped: boolean;
}

/**
 * Reads a numeric string, handling thousands separators in both the
 * `1,234.56` and `1.234,56` conventions, parentheses-negatives, trailing
 * minus signs and currency markers.
 *
 * Returns the decimal count alongside the value, because deciding the Excel
 * number format needs to know whether `1,234` had three decimals or a
 * thousands group — a distinction that is lost once it becomes a `number`.
 */
export function analyzeNumeric(input: string): NumericAnalysis | null {
	let s = input.trim();
	if (!s) return null;
	if (EASTERN_DIGITS.test(s)) s = foldEasternDigits(s);

	let negative = false;

	// Accounting negatives: (1,234) and 1,234-
	if (/^\(.*\)$/.test(s)) {
		negative = true;
		s = s.slice(1, -1).trim();
	}
	if (/-$/.test(s)) {
		negative = true;
		s = s.slice(0, -1).trim();
	}
	if (/^[-−–]/.test(s)) {
		negative = true;
		s = s.slice(1).trim();
	}
	if (/^\+/.test(s)) s = s.slice(1).trim();

	s = s.replace(CURRENCY_RE, '').trim();
	s = s.replace(/%$/, '').trim();
	// Trailing currency words, e.g. "1 234 kr" or "45 %"
	s = s.replace(/\s*(?:kr|zł|lei|USD|EUR|GBP|CHF|CAD|AUD|JPY)$/i, '').trim();

	if (!/^[\d.,\s'’]+$/.test(s)) return null;
	if (!/\d/.test(s)) return null;

	// Space and apostrophe are only ever group separators.
	const spaced = /[\s'’]/.test(s);
	s = s.replace(/[\s'’]/g, '');

	const lastComma = s.lastIndexOf(',');
	const lastDot = s.lastIndexOf('.');
	let grouped = spaced;

	if (lastComma !== -1 && lastDot !== -1) {
		// Whichever separator comes last is the decimal point.
		if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
		else s = s.replace(/,/g, '');
		grouped = true;
	} else if (lastComma !== -1) {
		// `1,234` and `12,345,678` are groups; `1,23` and `1,2345` are decimals.
		if (/^\d{1,3}(,\d{3})+$/.test(s)) {
			s = s.replace(/,/g, '');
			grouped = true;
		} else {
			s = s.replace(',', '.');
		}
	} else if (lastDot !== -1) {
		if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
			s = s.replace(/\./g, '');
			grouped = true;
		}
	}

	const value = Number(s);
	if (!Number.isFinite(value)) return null;

	const decimals = s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
	return { value: negative ? -value : value, decimals, grouped };
}

/** The value alone, when the formatting hints aren't needed. */
export function parseNumeric(input: string): number | null {
	return analyzeNumeric(input)?.value ?? null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const MONTH_NAMES =
	'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december';
const TEXT_DATE = new RegExp(`^(${MONTH_NAMES})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'i');
const TEXT_DATE_DMY = new RegExp(`^(\\d{1,2})\\s+(${MONTH_NAMES})\\.?\\s+(\\d{4})$`, 'i');

const MONTH_INDEX: Record<string, number> = {};
'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').forEach((m, i) => {
	MONTH_INDEX[m] = i;
});

function monthFrom(name: string): number | null {
	const key = name.slice(0, 3).toLowerCase();
	return key in MONTH_INDEX ? MONTH_INDEX[key] : null;
}

/**
 * Recognises unambiguous dates only. `03/04/2025` is deliberately *not*
 * treated as a date because day-first and month-first are indistinguishable
 * and silently guessing wrong corrupts the data.
 */
export function parseDate(input: string): Date | null {
	const s = input.trim();

	const iso = ISO_DATE.exec(s);
	if (iso) {
		const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
		return Number.isNaN(d.getTime()) ? null : d;
	}

	const text = TEXT_DATE.exec(s);
	if (text) {
		const m = monthFrom(text[1]);
		if (m === null) return null;
		return new Date(Date.UTC(+text[3], m, +text[2]));
	}

	const textDmy = TEXT_DATE_DMY.exec(s);
	if (textDmy) {
		const m = monthFrom(textDmy[2]);
		if (m === null) return null;
		return new Date(Date.UTC(+textDmy[3], m, +textDmy[1]));
	}

	const dmy = DMY.exec(s);
	if (dmy) {
		const a = +dmy[1];
		const b = +dmy[2];
		// Only safe when one of the two can only be a day.
		if (a > 12 && b <= 12) return new Date(Date.UTC(+dmy[3], b - 1, a));
		if (b > 12 && a <= 12) return new Date(Date.UTC(+dmy[3], a - 1, b));
		return null;
	}

	return null;
}

/** Best-effort typing of a single OCR'd cell. */
export function coerce(input: string): Coerced {
	const s = cleanText(input);
	if (BLANKS.has(s.toLowerCase())) return { v: null, t: 'blank' };

	const lower = s.toLowerCase();
	if (TRUES.has(lower)) return { v: true, t: 'boolean' };
	if (FALSES.has(lower)) return { v: false, t: 'boolean' };

	if (s.startsWith('=')) return { v: s, t: 'formula' };

	// Percentages become real fractions so Excel arithmetic works. `٪` is the
	// Arabic percent sign and means exactly the same thing.
	if (/[%\u066a]\s*$/.test(s)) {
		const n = analyzeNumeric(s);
		if (n) {
			// `41.2 / 100` is 0.41200000000000003 in binary floating point, which
			// would render as a wrong-looking number in the grid.
			const v = Number((n.value / 100).toFixed(Math.min(n.decimals + 2, 12)));
			return { v, t: 'percent', fmt: n.decimals > 0 ? `0.${'0'.repeat(n.decimals)}%` : '0%' };
		}
	}

	if (CURRENCY_RE.test(s) || CURRENCY_GLYPH_RE.test(s)) {
		const n = analyzeNumeric(s);
		if (n) {
			const symbol = (CURRENCY_GLYPH_RE.exec(s) ?? ['$'])[0];
			const tail = n.decimals > 0 ? '.' + '0'.repeat(n.decimals) : '';
			return {
				v: n.value,
				t: 'currency',
				fmt: `"${symbol}"#,##0${tail};[Red]-"${symbol}"#,##0${tail}`
			};
		}
	}

	const date = parseDate(s);
	if (date) return { v: date.toISOString().slice(0, 10), t: 'date', fmt: 'yyyy-mm-dd' };

	const n = analyzeNumeric(s);
	if (n) {
		const tail = n.decimals > 0 ? '.' + '0'.repeat(n.decimals) : '';
		// A bare run of digits (a year, an id, a count) keeps its plain look;
		// only numbers the page itself grouped get a thousands separator.
		const fmt = n.grouped ? `#,##0${tail}` : n.decimals > 0 ? `0${tail}` : undefined;
		return { v: n.value, t: 'number', fmt };
	}

	return { v: s, t: 'text' };
}

/** Coerce and keep the original text alongside, for provenance. */
export function toCell(input: string, extra?: Partial<Cell>): Cell {
	const { v, t, fmt } = coerce(input);
	const cell: Cell = { v, t, ...extra };
	if (fmt) cell.fmt = fmt;
	const original = cleanText(input);
	if (t !== 'blank' && String(v) !== original) cell.raw = original;
	if (t === 'blank' && original) cell.raw = original;
	return cell;
}
