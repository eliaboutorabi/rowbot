/**
 * Finding the figure on the page, not just the table it was in.
 *
 * "Show on page" used to light up the whole table block, which on a
 * twenty-six-row ledger is most of the sheet of paper — true, and not much
 * help to somebody checking one number. This narrows it to the cell.
 *
 * Mistral cannot do this for us. A table comes back as one block with one
 * bounding box and its content as HTML; the only sub-table detail is
 * per-word confidence, and those carry offsets into the HTML string rather
 * than coordinates. So the geometry has to come from somewhere else.
 *
 * For a digital PDF it comes from the file. pdf.js hands back every text run
 * with its exact position, and Mistral's coordinate space is one uniform
 * scale away, so a cell's text can be matched to the run that drew it and the
 * result is exact. A scan has no text layer at all — the pages of a
 * photographed ledger yield zero runs — and there the best honest answer is
 * the row, taken by dividing the table's box by the number of rows in it.
 *
 * Which of those happened is reported rather than hidden. A highlight
 * confidently in the wrong place is worse than no highlight in an application
 * whose promise is that you can check its working, so the caller can draw a
 * located cell differently from an inferred row.
 */

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A run of text from the PDF, already in the OCR's coordinate space. */
export interface TextRun extends Box {
	text: string;
}

export type Precision = 'cell' | 'row' | 'table';

export interface Located {
	box: Box;
	precision: Precision;
}

/* ------------------------------------------------------------------ */

/**
 * Text reduced to what two renderings of the same figure have in common.
 *
 * The workbook holds `1234.5` where the page printed `1,234.50`, and a
 * Persian page prints `۱٬۲۳۴` for the same number again. Thousands
 * separators, spaces and currency marks are noise for this comparison;
 * digits and letters are not.
 */
export function normalise(text: string): string {
	return text
		.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
		.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
		.replace(/٫/g, '.')
		.toLowerCase()
		.replace(/[\s\u00a0,٬'’]/g, '')
		.replace(/^[£$€¥]/, '')
		.replace(/[()]/g, '')
		.trim();
}

/** Two numbers that differ only in trailing zeros are the same figure. */
function sameFigure(a: string, b: string): boolean {
	const numeric = /^-?\d*\.?\d+$/;
	if (!numeric.test(a) || !numeric.test(b)) return false;
	return Number(a) === Number(b);
}

const matches = (run: string, wanted: string) =>
	run === wanted || sameFigure(run, wanted) || (wanted.length >= 4 && run.includes(wanted));

const centreY = (box: Box) => box.y + box.height / 2;
const inside = (run: Box, table: Box) =>
	centreY(run) >= table.y &&
	centreY(run) <= table.y + table.height &&
	run.x + run.width >= table.x &&
	run.x <= table.x + table.width;

/**
 * Runs grouped into the visual lines they sit on, top to bottom.
 *
 * Matching by row order rather than by text alone is what makes a repeated
 * value findable: a ledger has "Monthly retainer" on nine different lines,
 * and the only thing distinguishing the one being asked about is which line
 * it is on.
 */
export function clusterRows(runs: TextRun[], tolerance = 0): TextRun[][] {
	if (!runs.length) return [];

	const sorted = [...runs].sort((a, b) => centreY(a) - centreY(b) || a.x - b.x);
	// A line's own height is the natural scale for "is this the same line".
	const gap =
		tolerance ||
		Math.max(2, (sorted.reduce((sum, run) => sum + run.height, 0) / sorted.length) * 0.6);

	const lines: TextRun[][] = [[sorted[0]]];
	for (const run of sorted.slice(1)) {
		const line = lines.at(-1)!;
		if (Math.abs(centreY(run) - centreY(line[0])) <= gap) line.push(run);
		else lines.push([run]);
	}

	return lines.map((line) => [...line].sort((a, b) => a.x - b.x));
}

/** The union of a set of boxes. */
function span(boxes: Box[]): Box {
	const x = Math.min(...boxes.map((b) => b.x));
	const y = Math.min(...boxes.map((b) => b.y));
	const right = Math.max(...boxes.map((b) => b.x + b.width));
	const bottom = Math.max(...boxes.map((b) => b.y + b.height));
	return { x, y, width: right - x, height: bottom - y };
}

/**
 * The `row`-th of `rows` equal bands of a table's box.
 *
 * Only as good as the assumption that rows are evenly spaced, which for a
 * printed ledger they generally are and for a form they are not. Used when
 * there is no text layer to do better with, and reported as a row rather than
 * as a cell so nobody reads more precision into it than is there.
 */
export function rowBand(table: Box, rows: number, row: number): Box {
	if (rows <= 0) return table;
	const height = table.height / rows;
	const at = Math.min(Math.max(row, 0), rows - 1);
	return { x: table.x, y: table.y + at * height, width: table.width, height };
}

export interface LocateRequest {
	/** The table block's box on the page, from the OCR. */
	table: Box;
	/** Every text run on that page, in the same coordinate space. */
	runs: TextRun[];
	/** What the cell holds, and what the page said, if they differ. */
	text: string;
	raw?: string;
	/** Which row of the table, counting its header, and how many there are. */
	row?: number;
	rows?: number;
}

/**
 * Where on the page a cell was printed.
 *
 * Never returns nothing: the table's own box is the floor, which is what the
 * viewer did before any of this and is still true.
 */
export function locateCell(request: LocateRequest): Located {
	const { table, runs, row, rows } = request;

	const wanted = [request.text, request.raw]
		.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
		.map(normalise)
		.filter((value) => value.length > 0);

	const fallback: Located =
		row !== undefined && rows !== undefined && rows > 0
			? { box: rowBand(table, rows, row), precision: 'row' }
			: { box: table, precision: 'table' };

	if (!wanted.length) return fallback;

	const within = runs.filter((run) => inside(run, table) && run.text.trim() !== '');
	if (!within.length) return fallback;

	const lines = clusterRows(within);

	/** Runs on one line whose text is the cell's, joined if it was split. */
	const onLine = (line: TextRun[]): Box | null => {
		for (const value of wanted) {
			const single = line.find((run) => matches(normalise(run.text), value));
			if (single) return single;

			// A figure drawn as several runs — "1", ",", "234.50" — is one cell.
			for (let start = 0; start < line.length; start++) {
				let joined = '';
				for (let end = start; end < line.length && end < start + 6; end++) {
					joined += normalise(line[end].text);
					if (joined === value) return span(line.slice(start, end + 1));
					if (joined.length > value.length) break;
				}
			}
		}
		return null;
	};

	// The line the row points at, when there is one, then outwards from it:
	// a header row the OCR counted differently should not lose the match.
	const order =
		row !== undefined && rows !== undefined && rows > 0
			? nearestFirst(lines.length, Math.round((row / rows) * lines.length))
			: lines.map((_, index) => index);

	for (const index of order) {
		const box = onLine(lines[index]);
		if (box) return { box, precision: 'cell' };
	}

	return fallback;
}

/** Indices ordered by distance from `start`: 4, 3, 5, 2, 6 … */
function nearestFirst(length: number, start: number): number[] {
	const from = Math.min(Math.max(start, 0), Math.max(length - 1, 0));
	const out: number[] = [];
	for (let step = 0; step < length; step++) {
		if (from - step >= 0) out.push(from - step);
		if (step > 0 && from + step < length) out.push(from + step);
	}
	return out;
}
