import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import { env } from '$env/dynamic/private';
import { databaseAuthToken, databaseUrl } from './env';

const authToken = databaseAuthToken(env);

const client = createClient({
	url: databaseUrl(env),
	...(authToken ? { authToken } : {})
});

export const db = drizzle(client, { schema });
