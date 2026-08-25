/**
 * Formats a cell for display in the grid.
 *
 * Excel number formats are their own language; this implements the subset
 * Rowbot actually produces (thousands grouping, fixed decimals, percent,
 * currency, dates) and falls back to the plain value for anything else, which
 * is always better than showing a broken pattern.
 */
import type { Cell } from '$lib/types/workbook';

function decimalsFrom(pattern: string): number {
	const match = /\.(0+)/.exec(pattern);
	return match ? match[1].length : 0;
}

function group(pattern: string): boolean {
	return pattern.includes('#,##');
}

/** Pulls `$` out of `"$"#,##0.00;[Red]-"$"#,##0.00`. */
function currencySymbol(pattern: string): string {
	const quoted = /"([^"]+)"/.exec(pattern);
	if (quoted) return quoted[1];
	const glyph = /[$€£¥₹₽₩฿₪]/.exec(pattern);
	return glyph ? glyph[0] : '';
}

const DATE = new Intl.DateTimeFormat('en-CA', {
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	timeZone: 'UTC'
});

export function formatCell(cell: Cell, columnFormat?: string): string {
	if (cell.t === 'blank' || cell.v === null || cell.v === undefined) return '';
	if (cell.t === 'formula') return `=${cell.f ?? cell.v}`;
	if (cell.t === 'boolean') return cell.v ? 'TRUE' : 'FALSE';

	if (cell.t === 'date') {
		const date = new Date(String(cell.v));
		return Number.isNaN(date.getTime()) ? String(cell.v) : DATE.format(date);
	}

	if (cell.t === 'text') return String(cell.v);

	const n = typeof cell.v === 'number' ? cell.v : Number(cell.v);
	if (!Number.isFinite(n)) return String(cell.v);

	// A column-level format is a deliberate override the agent or reviewer set;
	// the per-cell one came from whatever the page happened to print.
	const pattern = cell.fmt ?? columnFormat ?? '';

	if (cell.t === 'percent') {
		const decimals = pattern ? decimalsFrom(pattern) : 1;
		return `${(n * 100).toLocaleString('en-US', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals
		})}%`;
	}

	const decimals = decimalsFrom(pattern);
	const body = n.toLocaleString('en-US', {
		useGrouping: pattern ? group(pattern) : Math.abs(n) >= 10_000,
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals || 6
	});

	if (cell.t === 'currency') {
		const symbol = currencySymbol(pattern) || '$';
		return n < 0 ? `-${symbol}${body.replace('-', '')}` : `${symbol}${body}`;
	}

	return body;
}

export function isNumericCell(cell: Cell): boolean {
	return cell.t === 'number' || cell.t === 'currency' || cell.t === 'percent';
}

export const TYPE_LABEL: Record<Cell['t'], string> = {
	text: 'Text',
	number: 'Number',
	currency: 'Currency',
	percent: 'Percentage',
	date: 'Date',
	boolean: 'Boolean',
	formula: 'Formula',
	blank: 'Empty'
};
