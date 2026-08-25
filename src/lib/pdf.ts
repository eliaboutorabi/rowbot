/**
 * The one place that opens a PDF in the browser.
 *
 * pdf.js needs two directories of runtime data that it does not bundle:
 * `standard_fonts` for the base-14 faces a PDF may reference without
 * embedding, and `cmaps` for the predefined CJK encodings. It fetches them at
 * render time, and when a fetch fails the worker's font promise never settles
 * — `page.render()` neither resolves nor rejects, so the canvas stays blank
 * with no error to catch. In dev the default URLs resolve through Vite's
 * node_modules passthrough, so this failed only once deployed, and failed
 * silently.
 *
 * `npm run sync:pdfjs` copies both directories into `static/pdfjs/`.
 *
 * `renderPage` puts a deadline on the render for the same reason. Any future
 * asset that goes missing should show the reader an error, not a white page.
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

export async function renderPage(
	page: any,
	canvas: HTMLCanvasElement,
	context: CanvasRenderingContext2D,
	viewport: any
): Promise<void> {
	const task = page.render({ canvas, canvasContext: context, viewport });
	let timer: ReturnType<typeof setTimeout>;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			task.cancel();
			reject(new Error('That page took too long to draw.'));
		}, RENDER_TIMEOUT_MS);
	});
	try {
		await Promise.race([task.promise, deadline]);
	} finally {
		clearTimeout(timer!);
	}
}
