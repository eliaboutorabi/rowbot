/**
 * Who is allowed to spend what.
 *
 * Rowbot is a public demo backed by real, paid API keys, so an account that
 * signs up and starts converting is spending the operator's money. Everything
 * that decides how much of that is allowed lives here, in one file, so the
 * policy can be read and changed in one place rather than inferred from
 * scattered checks.
 *
 * Three tiers:
 *   free       — the default. One document, ten pages, a handful of turns.
 *   byok       — the account saved its own OpenAI and Mistral keys in
 *                Settings, so it is spending its own credit. Unmetered.
 *   unlimited  — an operator address listed in `ROWBOT_UNLIMITED_EMAILS`.
 *
 * The free tier is deliberately enough to see the whole product work end to
 * end — read a document, watch the harness, correct it, export the workbook —
 * and not enough to be worth farming.
 */
import { error } from '@sveltejs/kit';
import { count, eq, sql, sum } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { document, run, userCredential } from '$lib/server/db/schema';
import { decryptSecret } from '$lib/server/secrets';

/** One document is enough to see the whole pipeline work. */
export const FREE_DOCUMENTS = 1;
/** Ten pages of Mistral OCR is a few cents. A 400-page PDF is not. */
export const FREE_PAGES = 10;
/** The first conversion plus room to correct it a few times. */
export const FREE_TURNS = 6;
/**
 * Even on their own key, a document far past this cannot finish inside the
 * 300s function budget — rejecting it up front beats a timeout half an hour in.
 */
export const BYOK_PAGES = 200;

export type Tier = 'free' | 'byok' | 'unlimited';

export interface Meter {
	used: number;
	/** `null` means unmetered. */
	limit: number | null;
}

export interface Allowance {
	tier: Tier;
	documents: Meter;
	turns: Meter;
	pageLimit: number;
	/** Masked fragments of the account's own keys, safe to render. */
	keyHints: { openai: string | null; mistral: string | null };
}

/** Operator addresses that bypass metering entirely. */
function unlimitedEmails(): Set<string> {
	return new Set(
		(env.ROWBOT_UNLIMITED_EMAILS ?? '')
			.split(',')
			.map((entry) => entry.trim().toLowerCase())
			.filter(Boolean)
	);
}

export function isUnlimited(email: string): boolean {
	return unlimitedEmails().has(email.trim().toLowerCase());
}

export interface StoredKeys {
	openai: string | null;
	mistral: string | null;
	openaiHint: string | null;
	mistralHint: string | null;
}

const NO_KEYS: StoredKeys = { openai: null, mistral: null, openaiHint: null, mistralHint: null };

/**
 * The account's own keys, decrypted. Server-only — the plaintext must never
 * reach a load function's return value or a JSON response.
 */
export async function storedKeys(userId: string): Promise<StoredKeys> {
	const [row] = await db
		.select()
		.from(userCredential)
		.where(eq(userCredential.userId, userId))
		.limit(1);

	if (!row) return NO_KEYS;

	return {
		openai: decryptSecret(row.openaiKey),
		mistral: decryptSecret(row.mistralKey),
		openaiHint: row.openaiHint,
		mistralHint: row.mistralHint
	};
}

/** Both keys, or the tier does not change: OCR needs one, the agent the other. */
const complete = (keys: StoredKeys) => Boolean(keys.openai && keys.mistral);

export interface AllowanceUser {
	id: string;
	email: string;
}

export async function allowanceFor(user: AllowanceUser): Promise<Allowance> {
	const [keys, [docs], [turns]] = await Promise.all([
		storedKeys(user.id),
		db.select({ n: count() }).from(document).where(eq(document.userId, user.id)),
		db
			.select({ n: sum(run.turns) })
			.from(run)
			.where(eq(run.userId, user.id))
	]);

	const tier: Tier = isUnlimited(user.email) ? 'unlimited' : complete(keys) ? 'byok' : 'free';
	const metered = tier === 'free';

	return {
		tier,
		documents: { used: docs?.n ?? 0, limit: metered ? FREE_DOCUMENTS : null },
		turns: { used: Number(turns?.n ?? 0), limit: metered ? FREE_TURNS : null },
		pageLimit: metered ? FREE_PAGES : BYOK_PAGES,
		keyHints: { openai: keys.openaiHint, mistral: keys.mistralHint }
	};
}

/* ------------------------------------------------------------------ */
/* Enforcement                                                         */
/* ------------------------------------------------------------------ */

/**
 * 402 rather than 403 throughout: the request is well-formed and the account
 * is legitimate, there is simply nothing left in the allowance. The client
 * keys off the status to show the "add your own keys" prompt.
 */
const OUT_OF_ALLOWANCE = 402;

const settingsHint =
	'Add your own OpenAI and Mistral API keys in Settings to keep going — Rowbot will use yours instead, with no limits.';

export async function assertCanUpload(user: AllowanceUser, pageCount: number | null) {
	const allowance = await allowanceFor(user);

	if (allowance.documents.limit !== null && allowance.documents.used >= allowance.documents.limit) {
		error(
			OUT_OF_ALLOWANCE,
			`You have used your ${allowance.documents.limit === 1 ? 'free document' : `${allowance.documents.limit} free documents`}. ${settingsHint}`
		);
	}

	if (pageCount !== null && pageCount > allowance.pageLimit) {
		error(
			OUT_OF_ALLOWANCE,
			allowance.tier === 'free'
				? `That document is ${pageCount} pages and the free limit is ${allowance.pageLimit}. ${settingsHint}`
				: `That document is ${pageCount} pages. Rowbot caps a single run at ${allowance.pageLimit} so it can finish inside the request budget — split it and upload the parts.`
		);
	}

	return allowance;
}

export async function assertCanRun(user: AllowanceUser) {
	const allowance = await allowanceFor(user);

	if (allowance.turns.limit !== null && allowance.turns.used >= allowance.turns.limit) {
		error(
			OUT_OF_ALLOWANCE,
			`You have used all ${allowance.turns.limit} free agent turns. ${settingsHint}`
		);
	}

	return allowance;
}

/* ------------------------------------------------------------------ */
/* Key resolution                                                      */
/* ------------------------------------------------------------------ */

export interface ResolvedKeys {
	openai: string;
	mistral: string;
	/** Whose credit this run spends. Surfaced in the UI, never guessed at. */
	source: 'user' | 'platform';
}

/**
 * Picks the keys a run will use. An account's own keys always win, so an
 * operator who has saved personal keys is not silently billing the platform.
 */
export async function resolveKeys(user: AllowanceUser): Promise<ResolvedKeys> {
	const keys = await storedKeys(user.id);
	if (complete(keys)) {
		return { openai: keys.openai!, mistral: keys.mistral!, source: 'user' };
	}

	const openai = env.OPENAI_API_KEY;
	const mistral = env.MISTRAL_API_KEY;
	if (!openai || !mistral) {
		error(
			503,
			'Rowbot has no provider keys configured. Add your own OpenAI and Mistral keys in Settings.'
		);
	}

	return { openai, mistral, source: 'platform' };
}

/** Records one billable agent turn against a run. */
export async function countTurn(runId: string) {
	await db
		.update(run)
		.set({ turns: sql`${run.turns} + 1` })
		.where(eq(run.id, runId));
}
