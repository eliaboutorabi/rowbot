/**
 * The workbook model is the single source of truth shared by the agent, the
 * grid viewer and the .xlsx exporter. It is intentionally JSON-serialisable:
 * it lives in LangGraph state, in the `workbook` table, and on the wire.
 */

export type CellValue = string | number | boolean | null;

export type CellType =
	'text' | 'number' | 'currency' | 'percent' | 'date' | 'boolean' | 'formula' | 'blank';

export interface Cell {
	/** Canonical, typed value. Numbers are real numbers, not "1,234". */
	v: CellValue;
	t: CellType;
	/** Excel formula without the leading `=`, when `t === 'formula'`. */
	f?: string;
	/** Verbatim OCR text, kept so the UI can show what was on the page. */
	raw?: string;
	/** Excel number format override for this cell. */
	fmt?: string;
	/** Agent-authored annotation, surfaced as a cell comment in Excel. */
	note?: string;
	/** OCR confidence 0..1, drives the confidence heat overlay. */
	conf?: number;
	/** Merge anchor: this cell spans `rs` rows and `cs` columns. */
	merge?: { rs: number; cs: number };
	/** True when this cell is covered by another cell's merge. */
	covered?: boolean;
	/**
	 * The result of an arithmetic check run over this cell.
	 *
	 * Set by `check_totals`, which does the sum itself rather than trusting the
	 * model's mental arithmetic. A `mismatch` is the most valuable thing Rowbot
	 * can tell you: the page printed one number and its own column adds up to
	 * another, so one of them was misread and a human should look.
	 */
	check?: {
		status: 'ok' | 'mismatch';
		message: string;
		/** What the page printed, when it disagrees with the arithmetic. */
		printed?: number;
	};
}

export interface Column {
	/** Stable machine key, e.g. `q1_revenue`. */
	key?: string;
	/** Display label; falls back to the header cell text. */
	label?: string;
	/** Width in Excel character units. */
	width?: number;
	/** Dominant type, used to format the whole column. */
	type?: CellType;
	fmt?: string;
}

export interface SheetSource {
	/** Zero-based page this sheet was extracted from. */
	pageIndex: number;
	/**
	 * Path of the OCR table in the agent's workspace, e.g.
	 * `/source/tables/page-1-tbl-0.html`. This rather than Mistral's raw table
	 * id: the path is what both the importer and the source overlay build with
	 * `tablePath()`, so the two always agree.
	 */
	tablePath?: string;
	/** Bounding box on the page, for the source overlay. */
	bbox?: { x0: number; y0: number; x1: number; y1: number };
}

export interface Sheet {
	id: string;
	/** Excel-safe sheet name, <= 31 chars, no []:*?/\ */
	name: string;
	/** Rectangular grid. Every row has `columns.length` cells. */
	rows: Cell[][];
	columns: Column[];
	/** Number of leading rows that are headers. */
	headerRows: number;
	freeze?: { rows: number; cols: number };
	source?: SheetSource;
	/**
	 * Extra OCR table paths appended into this sheet, when one table continued
	 * across page breaks. `source` stays the first page; this is the rest, in
	 * order, so provenance survives stitching.
	 */
	continuedFrom?: string[];
	/** Agent commentary about how this sheet was derived. */
	notes?: string;
}

export interface WorkbookModel {
	title: string;
	sheets: Sheet[];
	/** Free-form notes the agent wants the reviewer to see. */
	notes?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const blankCell = (): Cell => ({ v: null, t: 'blank' });

export function emptyWorkbook(title = 'Untitled'): WorkbookModel {
	return { title, sheets: [] };
}

const ILLEGAL_SHEET_CHARS = /[[\]:*?/\\]/g;

/**
 * Excel rejects sheet names over 31 chars, containing []:*?/\, starting or
 * ending with an apostrophe, or named "History". Duplicates are also fatal,
 * so callers pass the names already taken.
 */
export function safeSheetName(name: string, taken: readonly string[] = []): string {
	let base = (name || 'Sheet').replace(ILLEGAL_SHEET_CHARS, ' ').replace(/\s+/g, ' ').trim();
	base = base.replace(/^'+|'+$/g, '').trim();
	if (!base) base = 'Sheet';
	if (base.toLowerCase() === 'history') base = 'History_';
	base = base.slice(0, 31);

	const lower = new Set(taken.map((t) => t.toLowerCase()));
	if (!lower.has(base.toLowerCase())) return base;

	for (let i = 2; i < 1000; i++) {
		const suffix = ` ${i}`;
		const candidate = base.slice(0, 31 - suffix.length) + suffix;
		if (!lower.has(candidate.toLowerCase())) return candidate;
	}
	return base.slice(0, 27) + ' ' + Date.now().toString(36).slice(-3);
}

/** Pads every row to the widest row so the grid is truly rectangular. */
export function normalizeSheet(sheet: Sheet): Sheet {
	const width = Math.max(sheet.columns.length, ...sheet.rows.map((r) => r.length), 1);
	const rows = sheet.rows.map((row) => {
		const next = row.slice(0, width);
		while (next.length < width) next.push(blankCell());
		return next;
	});
	const columns = sheet.columns.slice(0, width);
	while (columns.length < width) columns.push({});
	return { ...sheet, rows, columns };
}

/** `0 -> A`, `26 -> AA`. Used by the grid header and the cell inspector. */
export function columnLetter(index: number): string {
	let n = index;
	let out = '';
	do {
		out = String.fromCharCode(65 + (n % 26)) + out;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return out;
}

export function cellRef(row: number, col: number): string {
	return `${columnLetter(col)}${row + 1}`;
}
