/**
 * Copy pdf.js's runtime data files into `static/pdfjs/`.
 *
 * pdf.js does not bundle these. It fetches them at render time from
 * `standardFontDataUrl` and `cMapUrl`, and when a fetch fails the worker's
 * font promise never settles — `page.render()` hangs forever rather than
 * rejecting, so the page comes out blank with no error anywhere. In dev the
 * default URLs happen to resolve through Vite's node_modules passthrough,
 * which is why this only ever broke in production.
 *
 * Run after upgrading pdfjs-dist:  npm run sync:pdfjs
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'pdfjs-dist');
const to = join(root, 'static', 'pdfjs');

mkdirSync(to, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps']) {
	rmSync(join(to, dir), { recursive: true, force: true });
	cpSync(join(from, dir), join(to, dir), { recursive: true });
	console.log(`pdfjs: synced ${dir}`);
}
