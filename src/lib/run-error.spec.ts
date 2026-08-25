import { describe, expect, it } from 'vitest';
import { describeRunFailure } from './run-error';

describe('describeRunFailure', () => {
	it('translates the concurrent-update crash into something actionable', () => {
		const raw =
			'Invalid update for channel "ocrIndex" with values [{"model":"mistral-ocr-4-1",' +
			'"pageCount":3}]: LastValue can only receive one value per step. Troubleshooting URL: ' +
			'https://docs.langchain.com/oss/javascript/langgraph/INVALID_CONCURRENT_GRAPH_UPDATE/';

		const failure = describeRunFailure(raw);

		expect(failure.title).not.toMatch(/ocrIndex|LastValue|http/);
		expect(failure.hint).toMatch(/still here/i);
		expect(failure.retryable).toBe(true);
		expect(failure.detail).toBe(raw);
	});

	it('keeps a short message as the whole story', () => {
		const failure = describeRunFailure('The run failed.');
		expect(failure).toEqual({ title: 'The run failed.', detail: null, retryable: true });
	});

	it('never puts more than a sentence in the headline', () => {
		const failure = describeRunFailure(`x${'y'.repeat(4000)}`);
		expect(failure.title.length).toBeLessThanOrEqual(140);
		expect(failure.detail).toHaveLength(4001);
	});

	it('does not offer to retry what retrying cannot fix', () => {
		expect(describeRunFailure('GRAPH_RECURSION_LIMIT reached').retryable).toBe(false);
	});

	it('names a rate limit as one', () => {
		expect(describeRunFailure('Request failed with status 429').title).toMatch(/rate limit/i);
	});
});
