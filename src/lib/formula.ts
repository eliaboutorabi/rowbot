/**
 * A small spreadsheet formula evaluator.
 *
 * Rowbot writes formulas into workbooks — a total as `SUM(B2:B6)`, a summary
 * sheet pulling figures out of the sheets it summarises. Excel recalculates
 * those on open, but two other readers cannot: the grid in this app, which has
 * no calculation engine, and anything that opens the file without recalculating
 * (Numbers, LibreOffice's preview, a script). A formula with no computed value
 * shows as blank or as its own text, which is how a "summary sheet" ends up
 * looking like a column of `=Ledger!B7` strings.
 *
 * So the formula is evaluated here, at the moment it is written, and the result
 * is stored beside it. The formula is still the formula — it goes into the
 * .xlsx as one and stays live if you edit the workbook — but every reader has a
 * number to show.
 *
 * The supported subset is what Rowbot actually produces. Anything outside it is
 * reported as an error rather than guessed at, because a summary cell holding a
 * wrong number is worse than one holding an honest complaint.
 */
import type { Cell } from './types/workbook';

export interface FormulaSheet {
	name: string;
	rows: Cell[][];
}

export interface FormulaContext {
	sheets: readonly FormulaSheet[];
	/** Sheet that unqualified references belong to. */
	current: string;
}

export type FormulaResult = { ok: true; value: number } | { ok: false; error: string };

/* ── Lexer ────────────────────────────────────────────────────────── */

type Token =
	| { kind: 'number'; value: number }
	| { kind: 'name'; value: string }
	| { kind: 'ref'; value: string }
	| { kind: 'op'; value: string };

const FUNCTIONS = new Set(['SUM', 'AVERAGE', 'AVG', 'COUNT', 'MIN', 'MAX', 'ROUND', 'ABS']);

/**
 * A reference, with an optional sheet qualifier that may be quoted.
 *
 * `'Regional Summary'!B2:B7`, `Ledger!B2`, `B2`. Excel doubles an apostrophe
 * inside a quoted name, which is why the quoted branch accepts `''`.
 */
const REF =
	/^(?:('(?:[^']|'')+'|[A-Za-z0-9_.À-￿ ]+)!)?(\$?[A-Za-z]{1,3}\$?\d{1,7})(?::(\$?[A-Za-z]{1,3}\$?\d{1,7}))?/;

function tokenize(input: string): Token[] | string {
	const tokens: Token[] = [];
	let i = 0;
	const src = input.trim().replace(/^=/, '');

	while (i < src.length) {
		const rest = src.slice(i);
		const char = src[i];

		if (/\s/.test(char)) {
			i++;
			continue;
		}

		// A function name is only a name when a bracket follows; otherwise the
		// same letters are the start of a reference like `SUM1` or `AB12`.
		const word = /^[A-Za-z][A-Za-z0-9_.]*/.exec(rest);
		if (word && /^\s*\(/.test(rest.slice(word[0].length))) {
			const name = word[0].toUpperCase();
			if (!FUNCTIONS.has(name)) return `${word[0]}() is not supported.`;
			tokens.push({ kind: 'name', value: name });
			i += word[0].length;
			continue;
		}

		const ref = REF.exec(rest);
		if (ref && (ref[1] || !word || ref[0].length >= word[0].length)) {
			tokens.push({ kind: 'ref', value: ref[0] });
			i += ref[0].length;
			continue;
		}

		const number = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
		if (number) {
			tokens.push({ kind: 'number', value: Number(number[0]) });
			i += number[0].length;
			continue;
		}

		if ('+-*/^(),'.includes(char)) {
			tokens.push({ kind: 'op', value: char });
			i++;
			continue;
		}

		return `Cannot read “${char}” in the formula.`;
	}

	return tokens;
}

/* ── References ───────────────────────────────────────────────────── */

function columnIndex(letters: string): number {
	let index = 0;
	for (const c of letters.toUpperCase()) index = index * 26 + (c.charCodeAt(0) - 64);
	return index - 1;
}

/** Every numeric value a reference covers. Blanks and text are skipped, as in Excel. */
function resolve(raw: string, ctx: FormulaContext): number[] | string {
	const match = REF.exec(raw);
	if (!match) return `“${raw}” is not a cell reference.`;

	const [, qualifier, from, to] = match;
	const wanted = qualifier
		? qualifier.replace(/^'|'$/g, '').replace(/''/g, "'").trim()
		: ctx.current;

	const sheet = ctx.sheets.find((s) => s.name.toLowerCase() === wanted.toLowerCase());
	if (!sheet) return `There is no sheet called “${wanted}”.`;

	const point = (a1: string) => {
		const parts = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(a1)!;
		return { row: Number(parts[2]) - 1, column: columnIndex(parts[1]) };
	};

	const a = point(from);
	const b = to ? point(to) : a;
	const values: number[] = [];

	for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
		for (let c = Math.min(a.column, b.column); c <= Math.max(a.column, b.column); c++) {
			const cell = sheet.rows[r]?.[c];
			if (!cell || cell.covered) continue;
			if (typeof cell.v === 'number' && Number.isFinite(cell.v)) values.push(cell.v);
		}
	}
	return values;
}

/* ── Parser ───────────────────────────────────────────────────────── */

class Parser {
	private at = 0;

	constructor(
		private readonly tokens: Token[],
		private readonly ctx: FormulaContext
	) {}

	private peek(): Token | undefined {
		return this.tokens[this.at];
	}

	private eat(value: string): boolean {
		const token = this.peek();
		if (token?.kind === 'op' && token.value === value) {
			this.at++;
			return true;
		}
		return false;
	}

	/** Everything a term evaluates to is a list: a scalar is a list of one. */
	parse(): number[] {
		const value = this.expression();
		if (this.at < this.tokens.length) throw new Error('There is something extra on the end.');
		return value;
	}

	private expression(): number[] {
		let left = this.term();
		for (;;) {
			if (this.eat('+')) left = [this.scalar(left) + this.scalar(this.term())];
			else if (this.eat('-')) left = [this.scalar(left) - this.scalar(this.term())];
			else return left;
		}
	}

	private term(): number[] {
		let left = this.power();
		for (;;) {
			if (this.eat('*')) left = [this.scalar(left) * this.scalar(this.power())];
			else if (this.eat('/')) {
				const divisor = this.scalar(this.power());
				if (divisor === 0) throw new Error('That formula divides by zero.');
				left = [this.scalar(left) / divisor];
			} else return left;
		}
	}

	private power(): number[] {
		const base = this.unary();
		// Right associative, as in Excel.
		if (this.eat('^')) return [Math.pow(this.scalar(base), this.scalar(this.power()))];
		return base;
	}

	private unary(): number[] {
		if (this.eat('-')) return [-this.scalar(this.unary())];
		if (this.eat('+')) return this.unary();
		return this.primary();
	}

	private primary(): number[] {
		const token = this.peek();
		if (!token) throw new Error('The formula ends too early.');

		if (token.kind === 'number') {
			this.at++;
			return [token.value];
		}

		if (token.kind === 'ref') {
			this.at++;
			const resolved = resolve(token.value, this.ctx);
			if (typeof resolved === 'string') throw new Error(resolved);
			// A bare reference to a blank or non-numeric cell is zero, as in Excel.
			return resolved.length ? resolved : [0];
		}

		if (token.kind === 'name') {
			this.at++;
			if (!this.eat('(')) throw new Error(`${token.value} needs brackets.`);
			const args: number[][] = [];
			if (!this.eat(')')) {
				do args.push(this.expression());
				while (this.eat(','));
				if (!this.eat(')')) throw new Error(`${token.value} is missing its closing bracket.`);
			}
			return [this.call(token.value, args)];
		}

		if (this.eat('(')) {
			const inner = this.expression();
			if (!this.eat(')')) throw new Error('A bracket is not closed.');
			return inner;
		}

		throw new Error(`Cannot read “${token.value}” here.`);
	}

	private call(name: string, args: number[][]): number {
		const flat = args.flat();
		switch (name) {
			case 'SUM':
				return flat.reduce((total, n) => total + n, 0);
			case 'AVERAGE':
			case 'AVG':
				if (!flat.length) throw new Error('AVERAGE has nothing to average.');
				return flat.reduce((total, n) => total + n, 0) / flat.length;
			case 'COUNT':
				return flat.length;
			case 'MIN':
				if (!flat.length) throw new Error('MIN has nothing to compare.');
				return Math.min(...flat);
			case 'MAX':
				if (!flat.length) throw new Error('MAX has nothing to compare.');
				return Math.max(...flat);
			case 'ABS':
				return Math.abs(this.scalar(args[0] ?? []));
			case 'ROUND': {
				const digits = args[1] ? this.scalar(args[1]) : 0;
				const factor = Math.pow(10, digits);
				return Math.round(this.scalar(args[0] ?? []) * factor) / factor;
			}
			default:
				throw new Error(`${name}() is not supported.`);
		}
	}

	/** A range cannot stand where a single number is needed. */
	private scalar(value: number[]): number {
		if (value.length !== 1) {
			throw new Error('A range cannot be used here — wrap it in SUM() or AVERAGE().');
		}
		return value[0];
	}
}

/**
 * The value of a formula, or why it has none.
 *
 * Never throws: this runs over model output, and a formula it cannot evaluate
 * is a thing to report back, not a crash.
 */
export function evaluateFormula(source: string, ctx: FormulaContext): FormulaResult {
	const tokens = tokenize(source);
	if (typeof tokens === 'string') return { ok: false, error: tokens };
	if (!tokens.length) return { ok: false, error: 'The formula is empty.' };

	try {
		const value = new Parser(tokens, ctx).parse();
		if (value.length !== 1) {
			return { ok: false, error: 'A bare range is not a value — wrap it in SUM() or AVERAGE().' };
		}
		if (!Number.isFinite(value[0]))
			return { ok: false, error: 'That formula does not resolve to a number.' };
		// Ten decimal places is past anything a document carries, and it clears
		// the floating-point dust that makes 0.1 + 0.2 print as 0.30000000000000004.
		return { ok: true, value: Number(value[0].toFixed(10)) };
	} catch (cause) {
		return {
			ok: false,
			error: cause instanceof Error ? cause.message : 'That formula is not valid.'
		};
	}
}
