/**
 * Where uploaded source documents live.
 *
 * Production uses Vercel Blob. Local development falls back to a gitignored
 * folder so the app runs with nothing but a `DATABASE_URL`, and reopening an
 * old document still shows its source page.
 */
import { del, head, put } from '@vercel/blob';
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
		access: 'public',
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

	const response = await fetch(blobUrl);
	if (!response.ok) {
		throw new Error(`Could not read the stored document (${response.status}).`);
	}
	return new Uint8Array(await response.arrayBuffer());
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
