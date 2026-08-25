/**
 * Typed client for Mistral Document AI (OCR 4).
 *
 * We call the REST endpoint directly rather than through the SDK: the request
 * we need is a single POST, and this keeps the serverless bundle small and the
 * exact request shape visible at the call site.
 */
import { env } from '$env/dynamic/private';

export const OCR_MODEL = 'mistral-ocr-4-1';
const ENDPOINT = 'https://api.mistral.ai/v1/ocr';

export interface OcrBBox {
	top_left_x: number;
	top_left_y: number;
	bottom_right_x: number;
	bottom_right_y: number;
}

export interface OcrBlock extends OcrBBox {
	type:
		| 'text'
		| 'title'
		| 'table'
		| 'list'
		| 'image'
		| 'equation'
		| 'caption'
		| 'code'
		| 'references'
		| 'aside_text'
		| 'header'
		| 'footer'
		| 'signature';
	content: string;
	/** Present on table blocks; joins the block to `page.tables`. */
	table_id?: string | null;
	confidence_scores?: {
		average_confidence_score?: number;
		minimum_confidence_score?: number;
	} | null;
}

export interface OcrWordConfidence {
	text: string;
	confidence: number;
	/** Offset of the word within `content`. */
	start_index: number;
}

export interface OcrTable {
	id: string;
	content: string;
	format: 'markdown' | 'html';
	/** Present when `confidence_scores_granularity` is `'word'`. */
	word_confidence_scores?: OcrWordConfidence[] | null;
}

export interface OcrPage {
	index: number;
	markdown: string;
	images: unknown[];
	tables?: OcrTable[] | null;
	hyperlinks?: string[] | null;
	header?: string | null;
	footer?: string | null;
	dimensions?: { dpi: number; height: number; width: number } | null;
	confidence_scores?: {
		average_page_confidence_score?: number;
		minimum_page_confidence_score?: number;
	} | null;
	blocks?: OcrBlock[] | null;
}

export interface OcrResponse {
	pages: OcrPage[];
	model: string;
	document_annotation?: string | null;
	usage_info: { pages_processed: number; doc_size_bytes?: number | null };
}

export class MistralOcrError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly retryable = false
	) {
		super(message);
		this.name = 'MistralOcrError';
	}
}

function apiKey(): string {
	const key = env.MISTRAL_API_KEY;
	if (!key) throw new MistralOcrError('MISTRAL_API_KEY is not set');
	return key;
}

export function isImageMime(mime: string): boolean {
	return mime.startsWith('image/');
}

/** Builds the `document` chunk Mistral expects for a PDF or an image. */
function documentChunk(bytes: Uint8Array, mimeType: string, filename: string) {
	const base64 = Buffer.from(bytes).toString('base64');
	const dataUri = `data:${mimeType};base64,${base64}`;
	return isImageMime(mimeType)
		? { type: 'image_url' as const, image_url: dataUri }
		: { type: 'document_url' as const, document_url: dataUri, document_name: filename };
}

export interface OcrOptions {
	/** Restrict to a page range, e.g. `'0-9'`. Page numbers start at 0. */
	pages?: string | number[];
	signal?: AbortSignal;
	model?: string;
}

/**
 * Runs OCR over a document. Tables come back as HTML so `rowspan`/`colspan`
 * survive; blocks carry bounding boxes for the source overlay; block-level
 * confidence drives the review heat map.
 */
export async function runOcr(
	bytes: Uint8Array,
	mimeType: string,
	filename: string,
	options: OcrOptions = {}
): Promise<OcrResponse> {
	const body = {
		model: options.model ?? OCR_MODEL,
		document: documentChunk(bytes, mimeType, filename),
		table_format: 'html',
		include_blocks: true,
		// Per-word rather than per-block: word offsets index into the table HTML,
		// which is what lets the reviewer see confidence cell by cell instead of
		// for a whole table at once.
		confidence_scores_granularity: 'word',
		include_image_base64: false,
		...(options.pages !== undefined ? { pages: options.pages } : {})
	};

	let response: Response;
	try {
		response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: options.signal
		});
	} catch (cause) {
		if ((cause as Error)?.name === 'AbortError') throw cause;
		throw new MistralOcrError(
			`Could not reach Mistral: ${(cause as Error).message}`,
			undefined,
			true
		);
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new MistralOcrError(
			`Mistral OCR failed (${response.status}): ${text.slice(0, 400)}`,
			response.status,
			response.status === 429 || response.status >= 500
		);
	}

	return (await response.json()) as OcrResponse;
}

/**
 * Reads the page count straight out of the PDF page tree so long documents can
 * be OCR'd in chunks that fit inside one serverless invocation. Returns 1 for
 * images and `null` when the structure can't be read.
 */
export function pdfPageCount(bytes: Uint8Array, mimeType: string): number | null {
	if (isImageMime(mimeType)) return 1;

	// Latin-1 keeps byte offsets intact, which matters for binary PDF streams.
	const text = Buffer.from(bytes).toString('latin1');

	let best = 0;
	const countRe = /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g;
	const altRe = /\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g;
	for (const re of [countRe, altRe]) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) best = Math.max(best, parseInt(m[1], 10));
	}
	if (best > 0) return best;

	const pages = text.match(/\/Type\s*\/Page[^s]/g);
	return pages?.length ? pages.length : null;
}

/** Splits `count` pages into `size`-page ranges in Mistral's `'0-9'` syntax. */
export function pageRanges(count: number, size: number): string[] {
	const out: string[] = [];
	for (let start = 0; start < count; start += size) {
		const end = Math.min(start + size - 1, count - 1);
		out.push(start === end ? `${start}` : `${start}-${end}`);
	}
	return out;
}
