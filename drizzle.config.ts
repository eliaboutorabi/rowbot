import { defineConfig } from 'drizzle-kit';
import { databaseAuthToken, databaseUrl } from './src/lib/server/db/env';

// Runs at build time on Vercel, where the Turso integration supplies the
// credentials under its own variable names — see ./src/lib/server/db/env.ts
export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'turso',
	dbCredentials: {
		url: databaseUrl(process.env),
		authToken: databaseAuthToken(process.env)
	},
	verbose: true,
	strict: true
});
