/** Small display helpers shared across the UI. */

export function fileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
	['year', 31_536_000_000],
	['month', 2_592_000_000],
	['week', 604_800_000],
	['day', 86_400_000],
	['hour', 3_600_000],
	['minute', 60_000]
];

export function timeAgo(value: Date | string | number): string {
	const then = new Date(value).getTime();
	const diff = then - Date.now();
	const magnitude = Math.abs(diff);

	for (const [unit, ms] of UNITS) {
		if (magnitude >= ms) return RELATIVE.format(Math.round(diff / ms), unit);
	}
	return 'just now';
}

export function duration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const compactNumber = (n: number) => COMPACT.format(n);

/**
 * The filename, when it is worth saying as well as the title.
 *
 * A project shows what the agent called the workbook, with the file it came
 * from underneath — which is useful when they differ ("Meridian Group —
 * Global Sales Ledger FY2025", from `huge-ledger`) and is noise when they do
 * not ("Elham Aboutorabi Diploma Transcript", from
 * `Elham Aboutorabi Diploma-transcript`, truncated to look like a worse copy
 * of the line above it).
 *
 * Compared on letters and digits alone, because the difference between the
 * two is almost always punctuation: a hyphen for a space, a dropped capital,
 * an ampersand written out.
 */
export function secondaryName(title: string | null, filename: string): string | null {
	if (!title) return null;

	const plain = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
	const a = plain(title);
	const b = plain(filename);
	if (!a || !b) return filename;

	// Either containing the other covers a filename that is the title with the
	// year lopped off, and a title that is the filename plus a few words.
	return a.includes(b) || b.includes(a) ? null : filename;
}
