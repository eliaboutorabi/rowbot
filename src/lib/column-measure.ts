/**
 * Measuring what each column actually needs, in the font it is drawn in.
 *
 * Character counts are a poor proxy — `1111111111` and `WWWWWWWWWW` are the
 * same length and nothing like the same width, and Persian is neither. A
 * canvas measures the real thing, and it is cheap enough to do on a sample of
 * the sheet every time the pane resizes.
 */
import { formatCell, isNumericCell } from '$lib/cell-format';
import { columnLetter, type Sheet } from '$lib/types/workbook';
import { representative, type ColumnDemand } from '$lib/column-layout';

/** Rows to measure. Enough to characterise a column, cheap on a 10,000-row sheet. */
const SAMPLE = 160;

/** `px-3` on each side, plus a little air so text never touches a rule. */
const PADDING = 30;

/** Narrow enough to still be clickable and to show two or three characters. */
const TEXT_FLOOR = 84;

/** Past this a column is a wall of prose, and the inspector is the better place for it. */
const TEXT_CEILING = 360;

let scratch: CanvasRenderingContext2D | null = null;

function context(font: string): CanvasRenderingContext2D | null {
	if (typeof document === 'undefined') return null;
	scratch ??= document.createElement('canvas').getContext('2d');
	if (scratch) scratch.font = font;
	return scratch;
}

/** Row indices to measure: every row on a small sheet, an even spread on a big one. */
function sampleRows(count: number): number[] {
	if (count <= SAMPLE) return Array.from({ length: count }, (_, i) => i);
	const stride = count / SAMPLE;
	return Array.from({ length: SAMPLE }, (_, i) => Math.floor(i * stride));
}

export interface MeasureOptions {
	/** The body font, as a CSS `font` shorthand. */
	font: string;
	/** The header font, which is heavier and therefore wider. */
	headerFont: string;
}

/**
 * What each column would like, and what it will not go below.
 *
 * A numeric column's minimum is the width of its widest *figure*: a truncated
 * word is still readable, a truncated number is a different number, and this
 * is a workbook whose whole promise is that the figures are right. Text
 * columns, and every column's header, carry the slack — which is what lets a
 * sheet fit its pane at all.
 */
export function measureColumns(sheet: Sheet, options: MeasureOptions): ColumnDemand[] {
	const body = context(options.font);
	const width = (text: string, header = false) => {
		if (!body) return text.length * 7.2;
		if (header) body.font = options.headerFont;
		const measured = body.measureText(text).width;
		if (header) body.font = options.font;
		return measured;
	};

	const rows = sampleRows(sheet.rows.length);

	return sheet.columns.map((column, c) => {
		/*
		 * Headers and figures are measured apart, because they are allowed
		 * different things. A header may be clipped — its full text is a hover
		 * and a click away, and the alternative is a column of two-character
		 * grades made 140px wide by the word above them, which is most of what
		 * was pushing this transcript off the side of the screen. A figure may
		 * not be clipped, so only the figures set a numeric column's floor.
		 */
		let headerDemand = width(column.label ?? columnLetter(c), true) + PADDING;
		const bodyWidths: number[] = [];
		let numeric = 0;
		let seen = 0;

		for (const r of rows) {
			const cell = sheet.rows[r]?.[c];
			if (!cell || cell.covered) continue;
			const text = formatCell(cell, column.fmt);
			if (!text) continue;

			if (r < sheet.headerRows) {
				headerDemand = Math.max(headerDemand, width(text, true) + PADDING);
				continue;
			}

			seen++;
			if (isNumericCell(cell)) numeric++;
			bodyWidths.push(width(text) + PADDING);
		}

		const widest = bodyWidths.length ? Math.max(...bodyWidths) : 0;
		const isNumeric = seen > 0 && numeric / seen >= 0.6;

		if (isNumeric) {
			const floor = Math.max(widest, TEXT_FLOOR);
			return {
				// Room for the header when there is room to spare, and the figures
				// alone when there is not.
				demand: Math.max(floor, Math.min(headerDemand, TEXT_CEILING)),
				min: floor,
				max: Math.max(floor, Math.min(headerDemand, TEXT_CEILING))
			};
		}

		const content = representative(bodyWidths);
		const demand = Math.min(
			Math.max(content, Math.min(headerDemand, 200), TEXT_FLOOR),
			TEXT_CEILING
		);

		return {
			demand,
			min: Math.min(TEXT_FLOOR, demand),
			// Room to grow into a half-empty pane, but not without limit: two
			// columns should not become two 600px columns because they can.
			max: Math.min(Math.max(demand * 1.8, 200), TEXT_CEILING)
		};
	});
}
