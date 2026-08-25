import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { document } from '$lib/server/db/schema';
import {
	ACCEPTED_MIME_TYPES,
	MAX_UPLOAD_BYTES,
	deleteDocument,
	isAcceptedMimeType,
	putDocument
} from '$lib/server/storage';
import { ownedDocument } from '$lib/server/runs';

const prettySize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Sign in to upload a document.');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No file was uploaded.');

	if (file.size === 0) error(400, 'That file is empty.');
	if (file.size > MAX_UPLOAD_BYTES) {
		error(
			413,
			`That file is ${prettySize(file.size)}. The limit is ${prettySize(MAX_UPLOAD_BYTES)}.`
		);
	}
	if (!isAcceptedMimeType(file.type)) {
		error(415, `Rowbot reads PDFs and images. Accepted types: ${ACCEPTED_MIME_TYPES.join(', ')}.`);
	}

	const documentId = crypto.randomUUID();
	const bytes = new Uint8Array(await file.arrayBuffer());
	const stored = await putDocument(locals.user.id, documentId, file.name, bytes, file.type);

	try {
		const [created] = await db
			.insert(document)
			.values({
				id: documentId,
				userId: locals.user.id,
				name: file.name.replace(/\.[a-z0-9]+$/i, '') || file.name,
				originalFilename: file.name,
				mimeType: file.type,
				sizeBytes: file.size,
				blobUrl: stored.url,
				blobPathname: stored.pathname,
				status: 'pending'
			})
			.returning();

		return json({ document: created }, { status: 201 });
	} catch (cause) {
		// Don't leave an orphaned blob behind if the row insert fails.
		await deleteDocument(stored.url);
		throw cause;
	}
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) error(401, 'Sign in first.');

	const documentId = url.searchParams.get('id');
	if (!documentId) error(400, 'Which document?');

	const doc = await ownedDocument(documentId, locals.user.id);
	await deleteDocument(doc.blobUrl);
	await db.delete(document).where(eq(document.id, doc.id));

	return json({ ok: true });
};
