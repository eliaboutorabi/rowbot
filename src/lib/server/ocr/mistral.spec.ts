import { afterEach, describe, expect, it, vi } from 'vitest';
import { MistralOcrError, runOcr } from './mistral';

vi.mock('$lib/server/provider-keys', () => ({ mistralKey: () => 'test-key' }));

const ok = () =>
	new Response(JSON.stringify({ pages: [], usage_info: { pages_processed: 1 } }), { status: 200 });

const fail = (status: number) => new Response('{"message":"Service unavailable."}', { status });

const bytes = new Uint8Array([1, 2, 3]);

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

/** Runs the call with the backoff waits collapsed to nothing. */
async function withoutWaiting<T>(work: () => Promise<T>): Promise<T> {
	vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
		fn();
		return 0 as unknown as ReturnType<typeof setTimeout>;
	}) as typeof setTimeout);
	return work();
}

describe('runOcr', () => {
	it('waits out a transient failure instead of ending the run', async () => {
		// The one that lost a real document: Mistral answered 503 once and the
		// whole conversion died with it.
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(fail(503))
			.mockResolvedValueOnce(ok());

		const result = await withoutWaiting(() => runOcr(bytes, 'application/pdf', 'a.pdf'));

		expect(result.usage_info.pages_processed).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('gives up after the retries, carrying the last status', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(fail(500));

		await expect(withoutWaiting(() => runOcr(bytes, 'application/pdf', 'a.pdf'))).rejects.toThrow(
			MistralOcrError
		);
	});

	it('does not retry a failure that will not change', async () => {
		// A 400 is the request being wrong. Sending it four times is four ways of
		// being wrong, and it delays the message the reviewer needs to see.
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fail(400));

		await expect(runOcr(bytes, 'application/pdf', 'a.pdf')).rejects.toThrow(/400/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
