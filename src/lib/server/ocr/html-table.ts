/**
 * Mistral OCR returns tables as HTML with `rowspan`/`colspan` intact. Excel
 * needs a rectangular grid, so this expands the HTML table model into one —
 * keeping merge anchors so the export can re-merge the cells that were
 * genuinely merged on the page.
 *
 * Deliberately a tiny hand-rolled parser rather than a DOM library: the input
 * is machine-generated and narrow, and this keeps the serverless bundle small.
 */
import { toCell } from '$lib/coerce';
import type { Cell, Sheet } from '$lib/types/workbook';
import { blankCell } from '$lib/types/workbook';

interface RawCell {
	text: string;
	rowspan: number;
	colspan: number;
	header: boolean;
}

interface RawRow {
	cells: RawCell[];
	inHead: boolean;
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	times: '×',
	deg: '°',
	euro: '€',
	pound: '£',
	yen: '¥',
	cent: '¢',
	sect: '§',
	para: '¶',
	middot: '·',
	bull: '•',
	dagger: '†',
	trade: '™',
	reg: '®',
	copy: '©'
};

export function decodeEntities(input: string): string {
	return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
		if (body[0] === '#') {
			const code =
				body[1] === 'x' || body[1] === 'X'
					? parseInt(body.slice(2), 16)
					: parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
		}
		return ENTITIES[body.toLowerCase()] ?? match;
	});
}

/** Cell text keeps line structure (`<br>` becomes a space) but drops markup. */
function cellText(inner: string): string {
	return decodeEntities(
		inner
			.replace(/<br\s*\/?>/gi, ' ')
			.replace(/<\/(p|div|li)>/gi, ' ')
			.replace(/<[^>]*>/g, '')
	)
		.replace(/\s+/g, ' ')
		.trim();
}

function attr(tag: string, name: string): number {
	const m = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(tag);
	if (!m) return 1;
	const n = parseInt(m[1], 10);
	// Guard against pathological spans from a bad OCR read.
	return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1;
}

/** Splits a document into the raw source of each `<table>`. */
export function splitTables(html: string): string[] {
	const out: string[] = [];
	const re = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) out.push(m[1]);
	return out;
}

function parseRows(tableInner: string): RawRow[] {
	const rows: RawRow[] = [];

	// Track thead regions so header rows can be detected even without <th>.
	const headRanges: Array<[number, number]> = [];
	const headRe = /<thead\b[^>]*>([\s\S]*?)<\/thead\s*>/gi;
	let hm: RegExpExecArray | null;
	while ((hm = headRe.exec(tableInner)) !== null) {
		headRanges.push([hm.index, hm.index + hm[0].length]);
	}
	const inHead = (pos: number) => headRanges.some(([a, b]) => pos >= a && pos < b);

	const rowRe = /<tr\b[^>]*>([\s\S]*?)(?:<\/tr\s*>|(?=<tr\b)|$)/gi;
	let rm: RegExpExecArray | null;
	while ((rm = rowRe.exec(tableInner)) !== null) {
		const cells: RawCell[] = [];
		const cellRe = /<(th|td)\b([^>]*)>([\s\S]*?)(?:<\/\1\s*>|(?=<(?:th|td)\b)|$)/gi;
		let cm: RegExpExecArray | null;
		while ((cm = cellRe.exec(rm[1])) !== null) {
			cells.push({
				text: cellText(cm[3]),
				rowspan: attr(cm[2], 'rowspan'),
				colspan: attr(cm[2], 'colspan'),
				header: cm[1].toLowerCase() === 'th'
			});
		}
		if (cells.length) rows.push({ cells, inHead: inHead(rm.index) });
	}

	return rows;
}

export interface ParsedTable {
	/** Rectangular grid, merges expanded. */
	rows: Cell[][];
	/** Leading rows that are headers. */
	headerRows: number;
	width: number;
}

/**
 * Expands a parsed HTML table using the standard table layout algorithm:
 * walk rows left to right, skipping slots already claimed by a span above.
 */
export function parseTableHtml(html: string): ParsedTable {
	const raw = parseRows(html.includes('<table') ? (splitTables(html)[0] ?? '') : html);
	if (!raw.length) return { rows: [], headerRows: 0, width: 0 };

	/** `r:c` slots claimed by a rowspan/colspan from an earlier cell. */
	const covered = new Set<string>();
	const grid: Cell[][] = [];
	const headerFlags: boolean[] = [];
	let width = 0;

	raw.forEach((row, r) => {
		if (!grid[r]) grid[r] = [];
		let c = 0;
		let headerCells = 0;

		for (const cell of row.cells) {
			while (covered.has(`${r}:${c}`)) c++;

			const anchor: Cell = toCell(cell.text);
			if (cell.rowspan > 1 || cell.colspan > 1) {
				anchor.merge = { rs: cell.rowspan, cs: cell.colspan };
			}
			grid[r][c] = anchor;
			if (cell.header) headerCells++;

			for (let dr = 0; dr < cell.rowspan; dr++) {
				for (let dc = 0; dc < cell.colspan; dc++) {
					if (dr === 0 && dc === 0) continue;
					covered.add(`${r + dr}:${c + dc}`);
					const rr = r + dr;
					const cc = c + dc;
					if (!grid[rr]) grid[rr] = [];
					// A cell covered by a vertical merge repeats the anchor's value so
					// the data stays usable if the reviewer unmerges it.
					grid[rr][cc] = { ...blankCell(), v: anchor.v, t: anchor.t, covered: true };
				}
			}

			c += cell.colspan;
			width = Math.max(width, c);
		}

		headerFlags[r] = headerCells > 0 && headerCells >= row.cells.length / 2;
		if (row.inHead) headerFlags[r] = true;
	});

	const rows = grid.map((row) => {
		const next: Cell[] = [];
		for (let c = 0; c < width; c++) next.push(row[c] ?? blankCell());
		return next;
	});

	// Header rows must be a contiguous run from the top.
	let headerRows = 0;
	while (headerRows < headerFlags.length && headerFlags[headerRows]) headerRows++;

	return { rows, headerRows, width };
}

/**
 * Builds column labels from the header rows, joining multi-row headers with
 * an en dash so `2024 / Rev` reads as `2024 – Rev`.
 */
export function headerLabels(rows: Cell[][], headerRows: number, width: number): string[] {
	if (headerRows === 0) return Array.from({ length: width }, () => '');
	const labels: string[] = [];
	for (let c = 0; c < width; c++) {
		const parts: string[] = [];
		for (let r = 0; r < headerRows; r++) {
			const text = rows[r]?.[c]?.v;
			const s = text == null ? '' : String(text).trim();
			if (s && parts[parts.length - 1] !== s) parts.push(s);
		}
		labels.push(parts.join(' – '));
	}
	return labels;
}

/** Convenience: a whole `Sheet` from one HTML table. */
export function sheetFromHtml(
	html: string,
	options: { id: string; name: string; source?: Sheet['source']; notes?: string }
): Sheet {
	const { rows, headerRows, width } = parseTableHtml(html);
	const labels = headerLabels(rows, headerRows, width);
	return {
		id: options.id,
		name: options.name,
		rows,
		columns: labels.map((label) => ({ label: label || undefined })),
		headerRows,
		freeze: headerRows > 0 ? { rows: headerRows, cols: 0 } : undefined,
		source: options.source,
		notes: options.notes
	};
}
