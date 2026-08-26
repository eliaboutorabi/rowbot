/**
 * `run_analysis` — let the agent do arithmetic by writing and running code.
 *
 * `check_totals` covers the one relationship a spreadsheet almost always has:
 * a column and the cell that sums it. It covers nothing else. An invoice line
 * where Amount should be Qty × Unit less a discount, a tax line that should be
 * a rate applied to a subtotal, a balance that should carry forward — none of
 * those are column sums, and until now the only thing checking them was the
 * model doing mental arithmetic, which is the one thing a language model
 * should never be trusted with and the reason a misread unit price of $129.95
 * survived in a workbook as $17.50.
 *
 * So the model writes the check instead of performing it. It describes the
 * relationship as code, this runs the code over the real cell values, and the
 * numbers come back from an interpreter rather than from a prediction. The
 * code is kept and shown, so a reviewer can see exactly what was asserted and
 * on what.
 *
 * The same tool recovers a figure the reader could not: given a row where the
 * amount is legible and the unit price is not, the unit price is arithmetic.
 * That is inference the model can justify, rather than a guess at a smudge.
 *
 * ## On the sandbox
 *
 * `node:vm` is a scope, not a security boundary, and it is not being asked to
 * be one: the code here is written by this application's own agent, running on
 * this application's own data, at the request of the person who uploaded it.
 * What the context is for is accidents — a script that loops forever, or
 * reaches for a database handle because it assumed it was in Node. It gets a
 * frozen set of built-ins, no module loader, no I/O of any kind, no timers,
 * and a deadline. Nothing it can touch outlives the call.
 */
import { tool, type ToolRuntime } from '@langchain/core/tools';
import { z } from 'zod';
import { createContext, runInNewContext } from 'node:vm';
import { cellRef, type WorkbookModel } from '$lib/types/workbook';
import type { RowbotContext } from '../state';
import { emitProgress } from '../events';

/** Long enough for arithmetic over a long ledger, short enough to notice. */
const DEADLINE_MS = 1500;

/** Values that survive the trip into the sandbox and back. */
type Plain = string | number | boolean | null;

interface RowbotState {
	workbook: WorkbookModel;
}

/**
 * The workbook as plain data.
 *
 * Values only — formulas arrive as the figure they last computed to, which is
 * what a check on a total wants to compare against. Cells keep their column
 * letters so a finding can be reported as `E4` and the reviewer can go there.
 */
function tabulate(model: WorkbookModel) {
	const sheets: Record<string, unknown> = {};

	for (const sheet of model.sheets) {
		const rows = sheet.rows.map((row) => row.map((cell) => (cell.v ?? null) as Plain));
		const headers = sheet.rows[0]?.map((cell) => String(cell.v ?? '')) ?? [];

		sheets[sheet.name] = {
			name: sheet.name,
			headerRows: sheet.headerRows,
			rows,
			headers,
			/** Body rows only, which is what nearly every check wants. */
			body: rows.slice(sheet.headerRows),
			/** `col('E')` → that column's values, body rows only. */
			col(letter: string) {
				const index =
					String(letter)
						.toUpperCase()
						.split('')
						.reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
				return rows.slice(sheet.headerRows).map((row) => row[index] ?? null);
			},
			/** `ref(3, 4)` → "E4", for reporting a finding at a place. */
			ref: (row: number, column: number) => cellRef(row, column)
		};
	}

	return sheets;
}

/** Only what arithmetic needs. No loader, no I/O, no clock, no randomness. */
function sandbox(sheets: Record<string, unknown>, logs: string[]) {
	return {
		sheets,
		Math,
		Number,
		String,
		Boolean,
		Array,
		Object,
		JSON,
		isNaN,
		isFinite,
		parseFloat,
		parseInt,
		/** Rounding to the penny, since that is what nearly every check needs. */
		round: (value: number, places = 2) => {
			const factor = 10 ** places;
			return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
		},
		log: (...parts: unknown[]) => {
			if (logs.length >= 200) return;
			logs.push(
				parts
					.map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
					.join(' ')
					.slice(0, 400)
			);
		}
	};
}

/** Whatever came back, as something that can go in a tool message. */
function present(value: unknown): string {
	if (value === undefined) return '(the code returned nothing)';
	try {
		const text = JSON.stringify(value, null, 2);
		return text === undefined ? String(value) : text.slice(0, 4000);
	} catch {
		return String(value).slice(0, 4000);
	}
}

const schema = z.object({
	code: z
		.string()
		.min(1)
		.max(8000)
		.describe(
			'JavaScript. `sheets` holds every sheet by name, each with `rows`, `body`, ' +
				'`headers`, `col("E")` and `ref(row, column)`. `log(...)` records a line. ' +
				'`round(x)` rounds to the penny. Return the answer; the value you return is ' +
				'what comes back to you. No imports, no I/O, no async.'
		),
	reason: z
		.string()
		.optional()
		.describe('What you are checking, in a few words. Shown to the reviewer.')
});

/**
 * Runs one script against one workbook. Exported so the sandbox can be tested
 * without standing up a graph runtime around it.
 */
export function analyse(model: WorkbookModel, code: string): { result: string; logs: string[] } {
	const logs: string[] = [];
	const context = createContext(sandbox(tabulate(model), logs), {
		codeGeneration: { strings: false, wasm: false }
	});

	try {
		// Wrapped in a function so `return` is available, which is the natural
		// way to hand an answer back and the way the schema describes.
		const value = runInNewContext(`(function () {\n${code}\n})()`, context, {
			timeout: DEADLINE_MS,
			filename: 'analysis.js'
		});
		return { result: present(value), logs };
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		// Errors come back as a result, not as a throw: a script that does not
		// compile is something the model can fix on the next turn, and ending the
		// run over a typo would lose the work either side of it.
		return { result: `The code did not run: ${message}`.slice(0, 1000), logs };
	}
}

export const runAnalysisTool = tool(
	async ({ code, reason }, runtime: ToolRuntime<never, RowbotContext>) => {
		const emit = emitProgress(runtime);
		const model = (runtime.state as RowbotState | undefined)?.workbook;
		if (!model?.sheets?.length) {
			return 'There is no workbook to analyse yet. Import a table first.';
		}

		emit({ kind: 'analysis:start', label: reason ?? 'Working it out', code });

		const { result, logs } = analyse(model, code);

		emit({ kind: 'analysis:end', label: reason ?? 'Working it out' });

		return [logs.length ? logs.join('\n') : null, logs.length ? '' : null, `Result: ${result}`]
			.filter((part) => part !== null)
			.join('\n');
	},
	{
		name: 'run_analysis',
		description:
			'Write and run JavaScript over the workbook to check or work out a figure. ' +
			'Use it for any relationship that is not a column sum — a line amount against ' +
			'quantity times price, a tax line against a rate, a balance carried forward — ' +
			'and to recover a figure the reader could not make out but the other figures ' +
			'in its row determine. Never do that arithmetic yourself: write it here and ' +
			'read the answer off the result.',
		schema
	}
);
