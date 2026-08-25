/**
 * How wide each column should be.
 *
 * Sizing every column to its widest cell is Excel's AutoFit, and it is what
 * makes a transcript with twelve columns need a thousand pixels of sideways
 * scrolling to read a page that was printed on one sheet of A4. Three ideas,
 * taken from how the good grids do it, get almost all of it back:
 *
 *  1. **One long cell should not set a column's width.** A demand is taken
 *     from the body of the distribution, not its tail — the same Q3 + 1.5×IQR
 *     rule MUI X uses to exclude outliers by default. The outlier still shows
 *     in full when you select it; it just stops taxing every other row.
 *
 *  2. **Fit the pane, then scroll.** Columns are allocated like flex items:
 *     they grow into spare room and shrink into their slack, so the common
 *     case needs no horizontal scrolling at all. Scrolling is what happens
 *     when the columns genuinely cannot fit, not the default.
 *
 *  3. **Numbers never shrink.** A truncated word is still readable; a
 *     truncated number is a *different number*, and this is a workbook whose
 *     entire promise is that the figures are right. So a numeric column's
 *     minimum is whatever it needs to show its longest value, and the squeeze
 *     is taken out of the text columns beside it.
 */

export interface ColumnDemand {
	/** What the column would like, in px. */
	demand: number;
	/** What it must never go below. */
	min: number;
	/** What it should never grow past, however much room there is. */
	max: number;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * The largest value that is not an outlier, by the interquartile rule.
 *
 * Returns the plain maximum for a handful of values, where quartiles mean
 * nothing and the "outlier" is as likely to be the only real row.
 */
export function representative(values: number[], factor = 1.5): number {
	if (!values.length) return 0;
	if (values.length < 8) return Math.max(...values);

	const sorted = [...values].sort((a, b) => a - b);
	const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
	const q1 = at(0.25);
	const q3 = at(0.75);
	const ceiling = q3 + factor * (q3 - q1);

	// The widest value that sits inside the fence — never zero, because a
	// column of identical values has an IQR of nothing and a fence at its own
	// value, which is exactly right.
	let best = 0;
	for (const value of sorted) if (value <= ceiling) best = value;
	return best || sorted[0];
}

/**
 * Distributes `available` px across the columns.
 *
 * The flexbox algorithm, essentially: move every column toward the target in
 * proportion to how far it *can* move, freeze the ones that hit a bound, and
 * go again with what is left. Converges in at most one pass per column.
 */
export function allocateWidths(columns: ColumnDemand[], available: number): number[] {
	const count = columns.length;
	if (!count) return [];

	const low = columns.map((column) => Math.max(column.min, 1));
	const high = columns.map((column, i) => Math.max(column.max, low[i]));
	const widths = columns.map((column, i) => clamp(column.demand, low[i], high[i]));
	const frozen = new Array<boolean>(count).fill(false);

	for (let pass = 0; pass <= count; pass++) {
		const difference = available - sum(widths);
		if (Math.abs(difference) < 0.5) break;

		const growing = difference > 0;
		const capacity = widths.map((width, i) =>
			frozen[i] ? 0 : Math.max(0, growing ? high[i] - width : width - low[i])
		);
		const pool = sum(capacity);
		if (pool <= 0) break;

		const step = Math.min(Math.abs(difference), pool);
		for (let i = 0; i < count; i++) {
			if (!capacity[i]) continue;
			const move = (step * capacity[i]) / pool;
			const next = growing ? widths[i] + move : widths[i] - move;

			if (growing ? next >= high[i] - 0.01 : next <= low[i] + 0.01) {
				widths[i] = growing ? high[i] : low[i];
				frozen[i] = true;
			} else {
				widths[i] = next;
			}
		}
	}

	return roundToWhole(widths);
}

/**
 * Whole pixels that still add up.
 *
 * Rounding each column independently loses up to half a pixel per column —
 * across seven columns that is a three-pixel sliver of background beside the
 * last one, which looks like a bug in a surface made of straight lines. So the
 * floors are taken first and the remainder handed out to the columns with the
 * largest fractions, which is the same largest-remainder rule that keeps
 * rounded percentages summing to a hundred.
 */
function roundToWhole(widths: number[]): number[] {
	const floors = widths.map((width) => Math.floor(width));
	let remainder = Math.round(sum(widths) - sum(floors));

	const order = widths
		.map((width, i) => ({ i, fraction: width - floors[i] }))
		.sort((a, b) => b.fraction - a.fraction);

	for (const { i } of order) {
		if (remainder <= 0) break;
		floors[i] += 1;
		remainder -= 1;
	}

	return floors;
}
