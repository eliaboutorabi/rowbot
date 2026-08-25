/**
 * Invite codes for sign-up.
 *
 * The account quota in `$lib/server/entitlements` bounds what one account can
 * spend. This bounds how many accounts there are, which is the other half:
 * a script that can register freely simply registers a thousand times.
 *
 * Codes live in `ROWBOT_INVITE_CODES` as a comma-separated list, so they can be
 * issued and revoked by editing one environment variable — no table, no admin
 * screen. **If the variable is unset, sign-up is closed**, not open: a missing
 * config should never be the thing that opens the door.
 */
import { env } from '$env/dynamic/private';

function codes(): Set<string> {
	return new Set(
		(env.ROWBOT_INVITE_CODES ?? '')
			.split(',')
			.map((code) => code.trim().toLowerCase())
			.filter(Boolean)
	);
}

/** False when no codes are configured — the fail-safe state. */
export function signUpOpen(): boolean {
	return codes().size > 0;
}

export function isValidInvite(code: string): boolean {
	const candidate = code.trim().toLowerCase();
	return candidate.length > 0 && codes().has(candidate);
}
