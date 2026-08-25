import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownedDocument } from '$lib/server/runs';
import { readDocument } from '$lib/server/storage';

/** Streams the original upload back for the source viewer's page overlay. */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Sign in first.');

	const doc = await ownedDocument(params.documentId, locals.user.id);
	if (!doc.blobUrl) error(404, 'That document has no stored file.');

	const bytes = await readDocument(doc.blobUrl);
	return new Response(bytes as unknown as BodyInit, {
		headers: {
			'content-type': doc.mimeType,
			'content-length': String(bytes.byteLength),
			'content-disposition': `inline; filename="${doc.originalFilename}"`,
			'cache-control': 'private, max-age=3600'
		}
	});
};
