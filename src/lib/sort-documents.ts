/**
 * The order the library is in.
 *
 * Newest-first is right for a shelf you are adding to and wrong for one you
 * are working through, and neither helps when you half-remember a name — so
 * it is a choice rather than a default.
 *
 * "Last worked on" is not the same as "date added" the moment anybody says
 * anything: it comes from the newest run on the document, and falls back to
 * when the file arrived for a project nobody has opened. Without that fallback
 * every untouched project sorts as though it were from 1970.
 */

export type SortKey = 'added' | 'modified' | 'name';

export const SORTS: { key: SortKey; label: string }[] = [
	{ key: 'added', label: 'Date added' },
	{ key: 'modified', label: 'Last worked on' },
	{ key: 'name', label: 'Name' }
];

export function isSortKey(value: unknown): value is SortKey {
	return typeof value === 'string' && SORTS.some((option) => option.key === value);
}

/** The shape this needs, so the whole document type does not have to travel. */
export interface Sortable {
	name: string;
	title?: string | null;
	createdAt: Date | string;
	conversation?: { lastActiveAt: Date | string } | null;
}

const time = (value: Date | string) => new Date(value).getTime();

/** What the library shows as the name, which is what "sort by name" must use. */
const shownName = (doc: Sortable) => (doc.title?.trim() || doc.name).trim();

/** When it was last worked on, or when it arrived if it never was. */
export const lastTouched = (doc: Sortable): number =>
	time(doc.conversation?.lastActiveAt ?? doc.createdAt);

/**
 * A new array, ordered. Never sorts in place: the caller's list comes from a
 * server load, and reordering that is how a list starts changing under a
 * reader who only typed in the search box.
 */
export function sortDocuments<T extends Sortable>(documents: readonly T[], key: SortKey): T[] {
	const sorted = [...documents];

	if (key === 'name') {
		// `localeCompare` with a base sensitivity so "ashfield" and "Ashfield"
		// land together rather than all the capitals coming first.
		return sorted.sort((a, b) =>
			shownName(a).localeCompare(shownName(b), undefined, { sensitivity: 'base', numeric: true })
		);
	}

	if (key === 'modified') return sorted.sort((a, b) => lastTouched(b) - lastTouched(a));

	return sorted.sort((a, b) => time(b.createdAt) - time(a.createdAt));
}
