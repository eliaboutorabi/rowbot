/**
 * Liveness checks for user-supplied provider keys.
 *
 * A key that is saved but wrong fails later, in the middle of a run, as an
 * opaque 401 from inside the harness. One cheap request at save time turns
 * that into a sentence next to the field.
 */
const TIMEOUT_MS = 8000;

export interface KeyCheck {
	ok: boolean;
	message?: string;
}

async function probe(url: string, key: string, provider: string): Promise<KeyCheck> {
	try {
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${key}` },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});

		if (response.ok) return { ok: true };
		if (response.status === 401 || response.status === 403) {
			return { ok: false, message: `${provider} rejected that key.` };
		}
		if (response.status === 429) {
			// Reachable and authenticated, just busy — no reason to refuse it.
			return { ok: true };
		}
		return {
			ok: false,
			message: `${provider} answered ${response.status} when checking that key.`
		};
	} catch (cause) {
		const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
		return {
			ok: false,
			message: timedOut
				? `${provider} did not respond in time. Try again in a moment.`
				: `Could not reach ${provider} to check that key.`
		};
	}
}

export const checkOpenAiKey = (key: string) =>
	probe('https://api.openai.com/v1/models', key, 'OpenAI');

export const checkMistralKey = (key: string) =>
	probe('https://api.mistral.ai/v1/models', key, 'Mistral');
