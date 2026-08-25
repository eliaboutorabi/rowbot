import { describe, expect, it } from 'vitest';
import { databaseAuthToken, databaseUrl } from './env';

describe('database credential resolution', () => {
	it('prefers an explicit DATABASE_URL', () => {
		expect(databaseUrl({ DATABASE_URL: 'file:local.db' })).toBe('file:local.db');
	});

	it("accepts the names Vercel's Turso integration actually injects", () => {
		// A `DATABASE` prefix on the Marketplace store produces this.
		expect(databaseUrl({ DATABASE_TURSO_DATABASE_URL: 'libsql://x.turso.io' })).toBe(
			'libsql://x.turso.io'
		);
		expect(databaseAuthToken({ DATABASE_TURSO_AUTH_TOKEN: 'tok' })).toBe('tok');

		// No prefix produces these.
		expect(databaseUrl({ TURSO_DATABASE_URL: 'libsql://y.turso.io' })).toBe('libsql://y.turso.io');
		expect(databaseAuthToken({ TURSO_AUTH_TOKEN: 'tok2' })).toBe('tok2');
	});

	it('ignores a variable that exists but is blank', () => {
		// Vercel creates empty placeholders from .env.example at import time;
		// those must not shadow the real credentials.
		expect(
			databaseUrl({ DATABASE_URL: '   ', DATABASE_TURSO_DATABASE_URL: 'libsql://real.turso.io' })
		).toBe('libsql://real.turso.io');
		expect(databaseAuthToken({ DATABASE_AUTH_TOKEN: '' })).toBeUndefined();
	});

	it('has no token for a local file database', () => {
		expect(databaseAuthToken({ DATABASE_URL: 'file:local.db' })).toBeUndefined();
	});

	it('names the variables it looked for when none are set', () => {
		expect(() => databaseUrl({})).toThrow(/DATABASE_URL.*TURSO_DATABASE_URL/s);
	});
});
