/**
 * Which pages of a file we hold no read for.
 *
 * The source view shows a page per stored read, so a document that has lost
 * one shows fewer pages and says nothing about it. That is how a bug in the
 * OCR writer — a narrower second pass deleting the pages it had not read —
 * went unnoticed: the viewer opened on page two and looked merely short.
 *
 * Numbering is the reason this cannot be left to the reader to spot. A
 * thumbnail is labelled with its real page number, so a document missing its
 * first page begins at "2" and a document that is genuinely three pages long
 * begins at "1" — but a document missing its *second* page reads 1, 3, 4 and
 * only a careful reader notices. Counting the gaps is the honest way.
 */

/** Page numbers, one-based and in order, that have no stored read. */
export function missingPages(pageCount: number, held: Iterable<number>): number[] {
	if (!Number.isFinite(pageCount) || pageCount <= 0) return [];

	const have = new Set(held);
	const gaps: number[] = [];
	for (let index = 0; index < pageCount; index++) {
		if (!have.has(index)) gaps.push(index + 1);
	}
	return gaps;
}

/** "3", "3 and 4", "1, 3 and 4" — a list as somebody would read it aloud. */
export function listNumbers(numbers: number[]): string {
	if (!numbers.length) return '';
	if (numbers.length === 1) return String(numbers[0]);
	return `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}
