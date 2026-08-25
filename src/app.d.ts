import type { auth } from '$lib/server/auth';

type SessionUser = (typeof auth)['$Infer']['Session']['user'];
type SessionData = (typeof auth)['$Infer']['Session']['session'];

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			/** Includes Rowbot's extra fields, e.g. the saved model preference. */
			user?: SessionUser;
			session?: SessionData;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
