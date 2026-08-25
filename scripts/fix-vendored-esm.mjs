/**
 * Workaround for an upstream packaging quirk in `@langchain/langgraph-sdk`.
 *
 * The SDK vendors pure-ESM dependencies (p-retry, p-queue, p-timeout, …) into
 * `dist/node_modules/.pnpm/<name>@<version>/node_modules/<name>/` and ships no
 * `package.json` alongside them. Node then has to walk several directories up
 * to decide whether those `.js` files are ESM or CJS, and on Vercel's runtime
 * that resolution lands on CommonJS — so the first `import` statement in the
 * file throws:
 *
 *   SyntaxError: Cannot use import statement outside a module
 *
 * Writing a two-key `package.json` into each vendored directory removes the
 * ambiguity: the module type is declared right where the files live, so no
 * upward walk is needed and every loader agrees.
 *
 * Idempotent, and a no-op once the SDK ships its own markers.
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Whether a directory holds a `.js` file at any depth. */
function hasJs(dir) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (hasJs(full)) return true;
		} else if (entry.endsWith('.js')) {
			return true;
		}
	}
	return false;
}

const ROOT = 'node_modules/@langchain/langgraph-sdk/dist/node_modules/.pnpm';

if (!existsSync(ROOT)) {
	console.log('[fix-vendored-esm] nothing to patch — vendored directory is gone');
	process.exit(0);
}

let patched = 0;

for (const pkgAtVersion of readdirSync(ROOT)) {
	const inner = join(ROOT, pkgAtVersion, 'node_modules');
	if (!existsSync(inner)) continue;

	for (const name of readdirSync(inner)) {
		const dir = join(inner, name);
		const manifest = join(dir, 'package.json');
		if (existsSync(manifest)) continue;
		// The vendored copies are ESM; their CJS siblings are separate `.cjs`
		// files, which this does not affect. Some packages keep their entry in
		// `dist/` rather than at the root, so look at any depth.
		if (!hasJs(dir)) continue;

		writeFileSync(manifest, JSON.stringify({ name, type: 'module' }, null, '\t') + '\n');
		patched++;
		console.log(`[fix-vendored-esm] declared ${name} as ESM`);
	}
}

console.log(`[fix-vendored-esm] patched ${patched} vendored package(s)`);
