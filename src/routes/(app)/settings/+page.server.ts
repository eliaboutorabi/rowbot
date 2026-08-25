import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { userCredential } from '$lib/server/db/schema';
import { allowanceFor } from '$lib/server/entitlements';
import { checkMistralKey, checkOpenAiKey, type KeyCheck } from '$lib/server/provider-check';
import { encryptSecret, maskKey } from '$lib/server/secrets';

export const load: PageServerLoad = async ({ locals }) => {
	// `allowanceFor` returns hints only — the plaintext keys never leave the
	// server, so there is nothing here for the browser to leak.
	return { allowance: await allowanceFor(locals.user!) };
};

/**
 * Every action returns the same shape. Without this the success and failure
 * branches produce a union whose members disagree on which fields exist, and
 * the template cannot read `form.openaiError` at all.
 */
const NO_FIELD_ERRORS = {
	openaiError: undefined as string | undefined,
	mistralError: undefined as string | undefined
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const openai = form.get('openai')?.toString().trim() ?? '';
		const mistral = form.get('mistral')?.toString().trim() ?? '';

		if (!openai && !mistral) {
			return fail(400, { ...NO_FIELD_ERRORS, message: 'Enter at least one key.' });
		}

		// Both providers are checked in parallel: a wrong key should be reported
		// on its own field, not as a single "something failed".
		const passes: KeyCheck = { ok: true };
		const [openaiCheck, mistralCheck] = await Promise.all([
			openai ? checkOpenAiKey(openai) : Promise.resolve(passes),
			mistral ? checkMistralKey(mistral) : Promise.resolve(passes)
		]);

		if (!openaiCheck.ok || !mistralCheck.ok) {
			return fail(400, {
				openaiError: openaiCheck.ok ? undefined : openaiCheck.message,
				mistralError: mistralCheck.ok ? undefined : mistralCheck.message,
				message: 'That did not work — see the fields below.'
			});
		}

		const patch: Partial<typeof userCredential.$inferInsert> = {};
		if (openai) {
			patch.openaiKey = encryptSecret(openai);
			patch.openaiHint = maskKey(openai);
		}
		if (mistral) {
			patch.mistralKey = encryptSecret(mistral);
			patch.mistralHint = maskKey(mistral);
		}

		await db
			.insert(userCredential)
			.values({ userId: locals.user!.id, ...patch })
			.onConflictDoUpdate({ target: userCredential.userId, set: patch });

		return {
			...NO_FIELD_ERRORS,
			saved: true,
			message: 'Saved. Rowbot will use your keys from now on.'
		};
	},

	remove: async ({ locals }) => {
		await db.delete(userCredential).where(eq(userCredential.userId, locals.user!.id));
		return {
			...NO_FIELD_ERRORS,
			saved: true,
			message: 'Your keys were deleted. The free allowance applies again.'
		};
	}
};
