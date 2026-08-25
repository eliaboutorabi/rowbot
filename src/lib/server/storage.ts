/**
 * Where uploaded source documents live.
 *
 * Production uses Vercel Blob with **private** access: these are people's
 * invoices and financial statements, and a public blob is readable by anyone
 * who has the URL. Reads therefore go through the SDK with the store token,
 * and the app serves them on through its own authenticated route.
 *
 * Local development falls back to a gitignored folder so the app runs with
 * nothing but a `DATABASE_URL`, and reopening an old document still shows its
 * source page.
 */
import { del, get, head, put } from '@vercel/blob';
import { env } from '$env/dynamic/private';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const LOCAL_ROOT = resolve('.rowbot-uploads');
const LOCAL_PREFIX = 'local:';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ACCEPTED_MIME_TYPES = [
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'image/tiff',
	'image/bmp',
	'image/avif'
] as const;

export function isAcceptedMimeType(mime: string): boolean {
	return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mime);
}

export function blobConfigured(): boolean {
	return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

export interface StoredBlob {
	url: string;
	pathname: string;
}

/** Keeps one user's uploads namespaced away from another's. */
function pathFor(userId: string, documentId: string, filename: string): string {
	const safe = filename.replace(/[^\w.-]/g, '_').slice(-80) || 'document';
	return `documents/${userId}/${documentId}/${safe}`;
}

export async function putDocument(
	userId: string,
	documentId: string,
	filename: string,
	bytes: Uint8Array,
	contentType: string
): Promise<StoredBlob> {
	const pathname = pathFor(userId, documentId, filename);

	if (!blobConfigured()) {
		const target = join(LOCAL_ROOT, pathname);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, bytes);
		return { url: `${LOCAL_PREFIX}${pathname}`, pathname };
	}

	const result = await put(pathname, Buffer.from(bytes), {
		access: 'private',
		contentType,
		token: env.BLOB_READ_WRITE_TOKEN,
		// The id already makes the path unique; a random suffix would break
		// the deterministic lookup used when re-reading the document.
		addRandomSuffix: false,
		allowOverwrite: true
	});
	return { url: result.url, pathname: result.pathname };
}

export async function readDocument(blobUrl: string): Promise<Uint8Array> {
	if (blobUrl.startsWith(LOCAL_PREFIX)) {
		const target = join(LOCAL_ROOT, blobUrl.slice(LOCAL_PREFIX.length));
		return new Uint8Array(await readFile(target));
	}

	// A private blob is not readable by a bare fetch — the token has to travel
	// with the request, which is the whole point of storing them privately.
	const result = await get(blobUrl, {
		access: 'private',
		token: env.BLOB_READ_WRITE_TOKEN
	});
	if (!result) throw new Error('That document is no longer in storage.');

	return new Uint8Array(await new Response(result.stream).arrayBuffer());
}

export async function deleteDocument(blobUrl: string | null): Promise<void> {
	if (!blobUrl) return;
	try {
		if (blobUrl.startsWith(LOCAL_PREFIX)) {
			await unlink(join(LOCAL_ROOT, blobUrl.slice(LOCAL_PREFIX.length)));
			return;
		}
		await del(blobUrl, { token: env.BLOB_READ_WRITE_TOKEN });
	} catch {
		// A missing blob is already in the desired state.
	}
}

/** Used by the source viewer to stream a document back to the browser. */
export async function documentExists(blobUrl: string): Promise<boolean> {
	if (blobUrl.startsWith(LOCAL_PREFIX)) {
		try {
			await readFile(join(LOCAL_ROOT, blobUrl.slice(LOCAL_PREFIX.length)));
			return true;
		} catch {
			return false;
		}
	}
	try {
		await head(blobUrl, { token: env.BLOB_READ_WRITE_TOKEN });
		return true;
	} catch {
		return false;
	}
}
