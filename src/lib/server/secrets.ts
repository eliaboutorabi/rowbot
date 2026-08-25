/**
 * Symmetric encryption for the API keys users store in Settings.
 *
 * A user's OpenAI and Mistral keys are their money. They are never returned to
 * the browser after being saved, never logged, and never written to the
 * database in the clear — only a masked hint (`sk-…4f2a`) is readable.
 *
 * The encryption key is derived from `BETTER_AUTH_SECRET` rather than adding a
 * second secret to configure: one strong value, one place to rotate. Rotating
 * it invalidates stored keys, which fail closed — the account falls back to
 * the free allowance and is asked to re-enter them.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Bumped if the scheme ever changes, so old ciphertexts stay identifiable. */
const VERSION = 'v1';

let cached: Buffer | null = null;

function encryptionKey(): Buffer {
	if (cached) return cached;

	const secret = env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error('BETTER_AUTH_SECRET is not set — cannot store API keys safely.');

	// HKDF keeps this key distinct from the one better-auth uses for sessions,
	// so neither can be used to attack the other.
	cached = Buffer.from(hkdfSync('sha256', secret, 'rowbot.apikeys', VERSION, 32));
	return cached;
}

/** `v1.<iv>.<tag>.<ciphertext>`, each part base64url. */
export function encryptSecret(plaintext: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();

	return [VERSION, iv, tag, ciphertext].map(asPart).join('.');
}

const asPart = (part: string | Buffer) =>
	typeof part === 'string' ? part : part.toString('base64url');

/**
 * Returns `null` for anything that does not decrypt cleanly — a truncated
 * value, a tampered one, or a ciphertext from a previous secret. Callers treat
 * that as "this account has no key", which is the safe reading.
 */
export function decryptSecret(encoded: string | null | undefined): string | null {
	if (!encoded) return null;

	const parts = encoded.split('.');
	if (parts.length !== 4 || parts[0] !== VERSION) return null;

	try {
		const iv = Buffer.from(parts[1], 'base64url');
		const tag = Buffer.from(parts[2], 'base64url');
		const ciphertext = Buffer.from(parts[3], 'base64url');
		if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

		const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
	} catch {
		// GCM authentication failure, or a key that no longer matches.
		return null;
	}
}

/**
 * What the Settings page shows in place of a saved key: enough to recognise
 * which key is stored, not enough to use it.
 */
export function maskKey(key: string): string {
	const trimmed = key.trim();
	if (trimmed.length <= 8) return '••••';
	return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}
