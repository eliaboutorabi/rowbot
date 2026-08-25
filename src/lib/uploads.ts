/**
 * What Rowbot will accept, stated once.
 *
 * These lived in `$lib/server/storage.ts`, where the browser could not reach
 * them — so the drop zone advertised "up to 25 MB" as a hardcoded string and
 * checked nothing, and a 40 MB file was uploaded in full before the server
 * turned it away. Shared here, the copy, the client-side check and the
 * server's own guard all read the same numbers.
 */
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

/** `25.0 MB`, matching how the server phrases the same limit. */
export function prettySize(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Why this file cannot be uploaded, or `null` if it can.
 *
 * A browser sometimes reports an empty `type` for a file dragged from an
 * unusual source, so the extension is a fallback rather than the check: better
 * to let a plausible file through and have the server decide than to refuse
 * something Rowbot can actually read.
 */
export function rejectionReason(file: File): string | null {
	if (file.size > MAX_UPLOAD_BYTES) {
		return `That file is ${prettySize(file.size)}, and the limit is ${prettySize(MAX_UPLOAD_BYTES)}.`;
	}
	if (file.size === 0) return 'That file is empty.';

	if (file.type) {
		if (!isAcceptedMimeType(file.type)) {
			return 'Rowbot reads PDFs and images of tables. That is neither.';
		}
		return null;
	}

	const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
	const known = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'bmp', 'avif'];
	return known.includes(extension)
		? null
		: 'Rowbot reads PDFs and images of tables. That is neither.';
}
