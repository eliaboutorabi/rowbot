/**
 * Somewhere to keep a deck's thumbnail so it is drawn once, ever.
 *
 * Drawing one means fetching the whole PDF and running pdf.js over it. That is
 * a lot of work for a picture the size of a postage stamp, and the library
 * repeated it on every single visit — so the grid appeared, and then a beat
 * later the pages did, which reads as the page still loading after it has
 * finished.
 *
 * The Cache Storage API is the right shelf for this: it is meant for
 * responses, it survives a reload and a restart, the browser evicts it under
 * pressure rather than us having to, and unlike `localStorage` it takes a blob
 * without a base64 round trip that would make every thumbnail a third bigger.
 *
 * Everything here fails quietly. A thumbnail that cannot be cached is a
 * thumbnail drawn again next time, which is exactly what used to happen and
 * is not worth an error.
 */

/** Bump to invalidate every stored thumbnail — after a change to how they are drawn. */
const CACHE = 'rowbot-thumbnails-v1';

/** Not a real route. Cache Storage wants a URL, and this one collides with nothing. */
const keyFor = (documentId: string) => `/__thumbnail/${documentId}`;

const available = () => typeof caches !== 'undefined';

export async function readThumbnail(documentId: string): Promise<Blob | null> {
	if (!available()) return null;
	try {
		const cache = await caches.open(CACHE);
		const hit = await cache.match(keyFor(documentId));
		return hit ? await hit.blob() : null;
	} catch {
		return null;
	}
}

export async function writeThumbnail(documentId: string, blob: Blob): Promise<void> {
	if (!available()) return;
	try {
		const cache = await caches.open(CACHE);
		await cache.put(keyFor(documentId), new Response(blob));
	} catch {
		// Storage refused, or we are in a private window. Nothing to do.
	}
}

/**
 * Forget one, for when a document's pages have changed underneath it.
 * A re-read that rebuilds the pages should not leave the old picture up.
 */
export async function forgetThumbnail(documentId: string): Promise<void> {
	if (!available()) return;
	try {
		const cache = await caches.open(CACHE);
		await cache.delete(keyFor(documentId));
	} catch {
		// Nothing to do.
	}
}
