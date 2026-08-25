import { beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {
	BETTER_AUTH_SECRET: 'test-secret-value-at-least-32-chars-long'
};
vi.mock('$env/dynamic/private', () => ({ env }));

// Imported after the mock so the module reads the stub.
const { decryptSecret, encryptSecret, maskKey } = await import('./secrets');

describe('API key encryption', () => {
	beforeEach(() => {
		env.BETTER_AUTH_SECRET = 'test-secret-value-at-least-32-chars-long';
	});

	it('round-trips a key', () => {
		const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
		expect(decryptSecret(encryptSecret(key))).toBe(key);
	});

	it('produces a different ciphertext every time', () => {
		// A fresh IV per call: two accounts with the same key must not be
		// identifiable by comparing rows.
		const a = encryptSecret('sk-same');
		const b = encryptSecret('sk-same');
		expect(a).not.toBe(b);
		expect(decryptSecret(a)).toBe(decryptSecret(b));
	});

	it('never stores the key in the clear', () => {
		expect(encryptSecret('sk-visible-please-no')).not.toContain('visible');
	});

	it('rejects a tampered ciphertext rather than returning garbage', () => {
		const encoded = encryptSecret('sk-original');
		const parts = encoded.split('.');
		// Flip a character of the ciphertext; GCM's tag should catch it.
		parts[3] = parts[3][0] === 'A' ? 'B' + parts[3].slice(1) : 'A' + parts[3].slice(1);
		expect(decryptSecret(parts.join('.'))).toBeNull();
	});

	it('fails closed when the server secret has been rotated', async () => {
		const encoded = encryptSecret('sk-original');

		env.BETTER_AUTH_SECRET = 'a-completely-different-secret-value-32-chars';
		vi.resetModules();
		// A fresh module derives a fresh key from the rotated secret.
		const rotated = await import('./secrets');

		// Stored keys become unreadable rather than wrong: the account falls back
		// to the free allowance and is asked to enter them again.
		expect(rotated.decryptSecret(encoded)).toBeNull();
	});

	it('treats absent, malformed and unknown-version values as no key', () => {
		expect(decryptSecret(null)).toBeNull();
		expect(decryptSecret(undefined)).toBeNull();
		expect(decryptSecret('')).toBeNull();
		expect(decryptSecret('not-encrypted-at-all')).toBeNull();
		expect(decryptSecret('v9.AAAA.BBBB.CCCC')).toBeNull();
	});

	it('masks a key down to something recognisable but unusable', () => {
		expect(maskKey('sk-proj-abcdefghijklmnop4f2a')).toBe('sk-…4f2a');
		expect(maskKey('short')).toBe('••••');
	});
});
