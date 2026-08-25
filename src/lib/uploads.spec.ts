import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, isAcceptedMimeType, prettySize, rejectionReason } from './uploads';

/** A File of a given size without allocating the bytes. */
function file(name: string, type: string, size: number): File {
	const f = new File([], name, { type });
	Object.defineProperty(f, 'size', { value: size });
	return f;
}

describe('rejectionReason', () => {
	it('accepts a PDF within the limit', () => {
		expect(rejectionReason(file('ledger.pdf', 'application/pdf', 2_000_000))).toBeNull();
	});

	it('names both sizes when the file is too big', () => {
		const reason = rejectionReason(file('big.pdf', 'application/pdf', MAX_UPLOAD_BYTES + 1));
		expect(reason).toContain(prettySize(MAX_UPLOAD_BYTES));
		expect(reason).toContain('limit');
	});

	it('turns away a type Rowbot cannot read', () => {
		expect(rejectionReason(file('notes.docx', 'application/msword', 1000))).toMatch(
			/PDFs and images/
		);
	});

	it('turns away an empty file', () => {
		expect(rejectionReason(file('empty.pdf', 'application/pdf', 0))).toBe('That file is empty.');
	});

	it('falls back to the extension when the browser reports no type', () => {
		expect(rejectionReason(file('scan.tiff', '', 5000))).toBeNull();
		expect(rejectionReason(file('notes.docx', '', 5000))).toMatch(/PDFs and images/);
	});

	it('accepts every type the server accepts', () => {
		for (const mime of ['application/pdf', 'image/png', 'image/avif']) {
			expect(isAcceptedMimeType(mime)).toBe(true);
			expect(rejectionReason(file('x', mime, 1000))).toBeNull();
		}
	});
});
