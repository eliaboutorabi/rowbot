# Deploying Rowbot to Vercel

Everything in the repo is already configured — `vercel.json`, the SvelteKit
Vercel adapter, and a `maxDuration` of 300s on the agent's streaming endpoint
(the Hobby ceiling). What's left is the parts that live in your accounts.

Steps marked **you** need your login; I can't do them for you.

---

## 1. Import the repo — _you_

1. Go to [vercel.com/new](https://vercel.com/new).
2. Import `eliaboutorabi/rowbot`.
3. Leave every build setting alone — `vercel.json` sets them.
4. **Don't deploy yet.** Add the environment variables first (step 3), or the
   first build will fail on a missing `DATABASE_URL`.

## 2. Create the database — _you_

From the project's **Storage** tab, choose **Turso** in the Marketplace and
create a database. Vercel injects the connection variables automatically.

When it asks you to connect the store to the project, the **Custom Prefix**
field decides the variable names. Any of these work — the app resolves whichever
it finds (`src/lib/server/db/env.ts`):

| Prefix you choose | Variables injected                                         |
| ----------------- | ---------------------------------------------------------- |
| _(blank)_         | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`                   |
| `DATABASE`        | `DATABASE_TURSO_DATABASE_URL`, `DATABASE_TURSO_AUTH_TOKEN` |

The values are marked sensitive and cannot be read back out of the dashboard,
which is exactly why the app reads the injected names rather than expecting you
to copy them into a variable of your own.

## 3. Create the blob store — _you_

Same **Storage** tab → **Blob** → create a store. This injects
`BLOB_READ_WRITE_TOKEN`, which is what Rowbot uses to keep the original
uploads so the source view still works when you reopen a document weeks later.

## 4. Add the remaining variables — _you_

**Settings → Environment Variables**, for all three environments:

| Name                 | Value                                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| `ORIGIN`             | Your production URL, e.g. `https://rowbot.vercel.app`. No trailing slash. |
| `BETTER_AUTH_SECRET` | 32+ random characters — `openssl rand -base64 32`                         |
| `OPENAI_API_KEY`     | Your OpenAI key                                                           |
| `MISTRAL_API_KEY`    | Your Mistral key                                                          |

`ORIGIN` has to match the deployed URL exactly, including the scheme. Sessions
fail silently if it doesn't — that's the single most common setup mistake here.

> If you later add a custom domain, update `ORIGIN` and redeploy.

## 5. Deploy

Push to `main`, or hit **Deploy**. The build runs `npm run db:migrate` first,
which applies `drizzle/*.sql` to Turso, then builds the app. Migrations are
additive, so redeploys are safe.

## 6. Check it

1. Open the deployment and create an account.
2. Upload a PDF with a table.
3. Watch the activity feed — plan, then OCR progress, then sheets appearing.
4. Export the `.xlsx` and open it.

---

## Notes and limits

**Function duration.** The Hobby plan caps a function at 300s, which is what
`src/routes/api/agent/stream/+server.ts` declares. A long document can exceed
that. Because every step is checkpointed, the recovery is to send another
message — the agent resumes from the last completed step rather than starting
over. On Pro, raise `maxDuration` in that file to `800` and the ceiling mostly
stops mattering.

**Long documents.** OCR is chunked ten pages at a time so no single Mistral
call dominates the budget.

**Cost.** Two paid APIs are in play: Mistral charges per page OCR'd, OpenAI per
token. Reasoning effort is the main lever — `medium` is the default, `low` is
noticeably cheaper on clean documents, `max` is expensive.

**Tracing (optional).** Set `LANGSMITH_API_KEY`, `LANGSMITH_TRACING=true` and
`LANGSMITH_PROJECT=rowbot` to get full traces of every run in LangSmith.

**Auth.** Email and password only, by design. GitHub and Google are both a
small addition if you want them later: add the provider to `socialProviders` in
`src/lib/server/auth.ts`, set the client id and secret, and point the provider's
callback at `https://<your-domain>/api/auth/callback/<provider>`.
