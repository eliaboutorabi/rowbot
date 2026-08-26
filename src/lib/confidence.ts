/**
 * How sure the reader was, as a colour.
 *
 * This used to be three bands with a threshold at 85%, and the threshold never
 * fired. Across every document in the development database — 490 cells,
 * including a genuinely poor scan of a Persian transcript — the lowest
 * cell-level confidence recorded was 0.984. Mistral's confidence on a table
 * cell is either high or the cell comes back empty; it does not report the
 * 60–70% that a three-band legend is drawn for. So the bands were decoration:
 * every cell sat in the top one, and the reader learned nothing.
 *
 * A continuous ramp says something at the resolution the numbers actually
 * vary at. 99% and 91% are different colours here, which is the difference
 * that exists in the data, and the worst cell in a sheet can therefore tint
 * the control that opens the map — so a glance tells you whether it is worth
 * opening at all.
 *
 * The ramp is deliberately steep in the top tenth for that reason, and flat
 * below 0.8: everything down there is equally worth checking by hand.
 */

interface Stop {
	at: number;
	l: number;
	c: number;
	h: number;
}

/** Green through amber to red, in OKLCH so the middle does not go muddy. */
const RAMP: Stop[] = [
	{ at: 0.8, l: 0.6, c: 0.19, h: 27 },
	{ at: 0.9, l: 0.7, c: 0.17, h: 58 },
	{ at: 0.95, l: 0.79, c: 0.15, h: 92 },
	{ at: 0.98, l: 0.76, c: 0.15, h: 132 },
	{ at: 1, l: 0.7, c: 0.16, h: 155 }
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The point on the ramp for a confidence, as `l c h`. */
function ramp(conf: number): Stop {
	const value = Math.min(Math.max(conf, 0), 1);
	if (value <= RAMP[0].at) return RAMP[0];

	for (let i = 1; i < RAMP.length; i++) {
		const from = RAMP[i - 1];
		const to = RAMP[i];
		if (value > to.at) continue;

		const t = (value - from.at) / (to.at - from.at);
		return {
			at: value,
			l: mix(from.l, to.l, t),
			c: mix(from.c, to.c, t),
			h: mix(from.h, to.h, t)
		};
	}
	return RAMP[RAMP.length - 1];
}

/** A solid colour: for the icon, and for the marker on the legend. */
export function confidenceColor(conf: number, alpha = 1): string {
	const { l, c, h } = ramp(conf);
	const round = (n: number) => Math.round(n * 1000) / 1000;
	return alpha >= 1
		? `oklch(${round(l)} ${round(c)} ${round(h)})`
		: `oklch(${round(l)} ${round(c)} ${round(h)} / ${alpha})`;
}

/**
 * A wash, for tinting a cell.
 *
 * Weighted so a clean sheet is almost untinted and a doubtful cell is not:
 * a heat map where every cell is coloured is a heat map nobody can read.
 */
export function confidenceTint(conf: number): string {
	const doubt = Math.min(Math.max(1 - conf, 0), 0.2) / 0.2;
	return confidenceColor(conf, 0.05 + doubt * 0.3);
}

/** The gradient behind the legend, sampled across the ramp. */
export function confidenceGradient(): string {
	const steps = [0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.98, 0.99, 1];
	const stops = steps.map(
		(step) => `${confidenceColor(step)} ${Math.round(((step - 0.8) / 0.2) * 100)}%`
	);
	return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Where a confidence sits along that gradient, as a percentage. */
export function confidenceOffset(conf: number): number {
	const value = Math.min(Math.max(conf, 0.8), 1);
	// Rounded because (1 - 0.8) / 0.2 is 0.9999999999999998 in binary floating
	// point, and a marker at 99.99999% of the bar is a marker off the end of it.
	return Math.round(((value - 0.8) / 0.2) * 10000) / 100;
}

/** Plain words for the same number, for a tooltip or a screen reader. */
export function confidenceWords(conf: number): string {
	if (conf >= 0.98) return 'read cleanly';
	if (conf >= 0.95) return 'read well';
	if (conf >= 0.9) return 'slightly unsure';
	if (conf >= 0.8) return 'unsure — worth checking';
	return 'barely legible — check this';
}
