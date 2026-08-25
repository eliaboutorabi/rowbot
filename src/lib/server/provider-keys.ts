/**
 * The provider keys in scope for the current request.
 *
 * A run may be billed to the platform or to the signed-in account's own keys
 * (see `$lib/server/entitlements`), and the decision is made once, at the
 * edge of the request. Everything downstream — the chat model, the OCR client,
 * a tool three levels into a subagent — reads the answer from here.
 *
 * An `AsyncLocalStorage` rather than the agent's runtime context on purpose:
 * context values flow into LangGraph config and can end up in a checkpoint,
 * and a user's API key must never be written to the database. This store lives
 * and dies with the request.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '$env/dynamic/private';

export interface ProviderKeys {
	openai: string;
	mistral: string;
	source: 'user' | 'platform';
}

const store = new AsyncLocalStorage<ProviderKeys>();

/** Runs `fn` with these keys in scope, including everything it awaits. */
export function withProviderKeys<T>(keys: ProviderKeys, fn: () => T): T {
	return store.run(keys, fn);
}

export function currentProviderKeys(): ProviderKeys | undefined {
	return store.getStore();
}

/**
 * Falls back to the platform environment when no request scope is active, so
 * scripts and tests keep working. Request paths always establish the scope, so
 * this fallback never silently bills the platform for a BYOK account.
 */
function keyFor(field: 'openai' | 'mistral', envKey: string): string {
	const scoped = store.getStore();
	if (scoped) return scoped[field];

	const fallback = env[envKey];
	if (!fallback) throw new Error(`${envKey} is not set`);
	return fallback;
}

export const openaiKey = () => keyFor('openai', 'OPENAI_API_KEY');
export const mistralKey = () => keyFor('mistral', 'MISTRAL_API_KEY');
