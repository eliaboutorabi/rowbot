/**
 * The one place that opens a PDF in the browser.
 *
 * pdf.js needs two directories of runtime data that it does not bundle:
 * `standard_fonts` for base-14 faces a PDF references without embedding, and
 * `cmaps` for the predefined CJK encodings. It fetches them at render time,
 * and a fetch that 404s does not raise — the worker's font promise simply
 * never settles, so `page.render()` neither resolves nor rejects and the
 * canvas stays blank with nothing to catch. The default URLs resolve through
 * Vite's node_modules passthrough in dev and point at nothing in a build, so
 * the failure would only ever appear in production. `npm run sync:pdfjs`
 * copies both directories into `static/pdfjs/`.
 *
 * `renderPage` puts a deadline on the render as a backstop for the same class
 * of failure: a missing asset should reach the reader as an error, not as a
 * white page that never finishes.
 */

/** pdf.js has no published types for the document/page handles. */
/* eslint-disable @typescript-eslint/no-explicit-any */

let loading: Promise<any> | null = null;

async function pdfjs(): Promise<any> {
	loading ??= (async () => {
		const lib = await import('pdfjs-dist');
		const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
		lib.GlobalWorkerOptions.workerSrc = worker.default;
		return lib;
	})();
	return loading;
}

export async function openDocument(url: string): Promise<any> {
	const lib = await pdfjs();
	return lib.getDocument({
		url,
		standardFontDataUrl: '/pdfjs/standard_fonts/',
		cMapUrl: '/pdfjs/cmaps/',
		cMapPacked: true
	}).promise;
}

/** Long enough for a dense page on a slow machine, short enough to notice. */
const RENDER_TIMEOUT_MS = 20_000;

/**
 * A deadline that only counts down while the tab is on screen.
 *
 * pdf.js loads fonts through a `requestAnimationFrame` poll, and a browser
 * stops serving those to a hidden tab — so a render started in a background
 * tab does not progress until you come back to it. A plain `setTimeout` would
 * expire during that pause and cancel a render that was never given a chance,
 * leaving a permanently broken preview behind for anyone who opened the app in
 * a background tab. Wall-clock is the wrong clock here; visible time is the
 * one that matches what pdf.js is waiting on.
 */
function visibleDeadline(ms: number, onExpiry: () => void): () => void {
	let remaining = ms;
	let startedAt = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const stop = () => {
		if (timer === null) return;
		clearTimeout(timer);
		timer = null;
		remaining -= Date.now() - startedAt;
	};

	const start = () => {
		if (timer !== null || remaining <= 0) return;
		startedAt = Date.now();
		timer = setTimeout(onExpiry, remaining);
	};

	const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());

	document.addEventListener('visibilitychange', onVisibility);
	onVisibility();

	return () => {
		stop();
		document.removeEventListener('visibilitychange', onVisibility);
	};
}

export async function renderPage(
	page: any,
	canvas: HTMLCanvasElement,
	context: CanvasRenderingContext2D,
	viewport: any
): Promise<void> {
	const task = page.render({ canvas, canvasContext: context, viewport });
	let cancelDeadline = () => {};
	const expiry = new Promise<never>((_, reject) => {
		cancelDeadline = visibleDeadline(RENDER_TIMEOUT_MS, () => {
			task.cancel();
			reject(new Error('That page took too long to draw.'));
		});
	});
	try {
		await Promise.race([task.promise, expiry]);
	} finally {
		cancelDeadline();
	}
}
