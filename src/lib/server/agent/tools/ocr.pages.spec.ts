/**
 * A second, narrower OCR pass must not take the other pages with it.
 *
 * Runs against the configured database, on a document of its own that it
 * removes afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document as documentTable, documentPage, user } from '$lib/server/db/schema';
import { replacePages } from './ocr';

const USER_ID = 'pages-spec-user';
const DOC_ID = 'pages-spec-doc';

const page = (index: number, markdown: string) => ({
	id: `${DOC_ID}-p${index}-${markdown}`,
	documentId: DOC_ID,
	pageIndex: index,
	markdown,
	width: 1000,
	height: 1400
});

beforeAll(async () => {
	await db
		.insert(user)
		.values({
			id: USER_ID,
			name: 'Pages spec',
			email: 'pages-spec@rowbot.test',
			emailVerified: false,
			createdAt: new Date(),
			updatedAt: new Date()
		})
		.onConflictDoNothing();

	await db.delete(documentTable).where(eq(documentTable.id, DOC_ID));
	await db.insert(documentTable).values({
		id: DOC_ID,
		userId: USER_ID,
		name: 'pages-spec',
		originalFilename: 'pages-spec.pdf',
		mimeType: 'application/pdf',
		sizeBytes: 1,
		status: 'pending',
		createdAt: new Date(),
		updatedAt: new Date()
	});
});

afterAll(async () => {
	await db.delete(documentTable).where(eq(documentTable.id, DOC_ID));
	await db.delete(user).where(eq(user.id, USER_ID));
});

const stored = async () => {
	const rows = await db
		.select({ index: documentPage.pageIndex, markdown: documentPage.markdown })
		.from(documentPage)
		.where(eq(documentPage.documentId, DOC_ID))
		.orderBy(asc(documentPage.pageIndex));
	return rows;
};

describe('replacePages', () => {
	it('keeps the pages a narrower second pass did not read', async () => {
		const full = [0, 1, 2, 3, 4].map((index) => page(index, `first-${index}`));
		await expect(replacePages(DOC_ID, full)).resolves.toBe(5);

		// The agent re-reads pages 1-4 only. Page 0 must survive.
		const partial = [1, 2, 3, 4].map((index) => page(index, `second-${index}`));
		await expect(replacePages(DOC_ID, partial)).resolves.toBe(5);

		const rows = await stored();
		expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3, 4]);
		expect(rows[0].markdown).toBe('first-0');
		expect(rows[4].markdown).toBe('second-4');
	});

	it('replaces a page it did read', async () => {
		await replacePages(DOC_ID, [page(2, 'third-2')]);
		const rows = await stored();
		expect(rows).toHaveLength(5);
		expect(rows[2].markdown).toBe('third-2');
	});

	it('leaves what is stored alone when a pass returns nothing', async () => {
		await expect(replacePages(DOC_ID, [])).resolves.toBe(5);
		expect(await stored()).toHaveLength(5);
	});
});
