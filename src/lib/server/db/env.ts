/**
 * Resolving database credentials across the names different hosts inject.
 *
 * Vercel's Turso Marketplace integration creates its own variables
 * (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) and prepends whatever prefix you
 * chose when connecting the store — so a `DATABASE` prefix yields
 * `DATABASE_TURSO_DATABASE_URL`. Those values are marked sensitive and cannot
 * be read back out of the dashboard, so they cannot simply be copied into a
 * variable of our own choosing.
 *
 * Rather than make deployment depend on getting one exact name right, accept
 * the handful of shapes these integrations actually produce.
 */

const URL_KEYS = [
	'DATABASE_URL',
	'DATABASE_TURSO_DATABASE_URL',
	'TURSO_DATABASE_URL',
	'LIBSQL_URL'
] as const;

const TOKEN_KEYS = [
	'DATABASE_AUTH_TOKEN',
	'DATABASE_TURSO_AUTH_TOKEN',
	'TURSO_AUTH_TOKEN',
	'LIBSQL_AUTH_TOKEN'
] as const;

type Env = Record<string, string | undefined>;

/** First key with a non-empty value. Blank vars are treated as absent. */
function firstValue(env: Env, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = env[key]?.trim();
		if (value) return value;
	}
	return undefined;
}

export function databaseUrl(env: Env): string {
	const url = firstValue(env, URL_KEYS);
	if (!url) {
		throw new Error(
			`No database URL found. Set one of: ${URL_KEYS.join(', ')}. ` +
				'Locally, DATABASE_URL="file:local.db" is enough.'
		);
	}
	return url;
}

/** Absent for a local `file:` database; required by Turso. */
export function databaseAuthToken(env: Env): string | undefined {
	return firstValue(env, TOKEN_KEYS);
}

export { URL_KEYS, TOKEN_KEYS };
