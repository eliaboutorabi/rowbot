/**
 * Syntax highlighting for the code the agent writes.
 *
 * Small on purpose. The only source this ever sees is JavaScript written by
 * this application's own agent against a documented handful of helpers — no
 * JSX, no decorators, no template-literal types — so a full grammar would be
 * several hundred kilobytes to colour a twelve-line loop.
 *
 * Safe by construction, and that is the reason it tokenises rather than
 * running regexes over escaped text: the source is split into tokens first,
 * each token's text is escaped, and only then is any markup put around it. No
 * character of the input can become a tag, and no escape sequence introduced
 * by escaping can be mistaken for a token boundary.
 */

export type TokenKind =
	'comment' | 'string' | 'number' | 'keyword' | 'builtin' | 'property' | 'operator' | 'plain';

export interface Token {
	kind: TokenKind;
	text: string;
}

const KEYWORDS = new Set([
	'const',
	'let',
	'var',
	'function',
	'return',
	'if',
	'else',
	'for',
	'of',
	'in',
	'while',
	'do',
	'break',
	'continue',
	'switch',
	'case',
	'default',
	'new',
	'typeof',
	'instanceof',
	'delete',
	'void',
	'throw',
	'try',
	'catch',
	'finally',
	'class',
	'extends',
	'this',
	'true',
	'false',
	'null',
	'undefined'
]);

/** The names the sandbox puts in scope, plus the intrinsics worth marking. */
const BUILTINS = new Set([
	'sheets',
	'log',
	'round',
	'Math',
	'Number',
	'String',
	'Boolean',
	'Array',
	'Object',
	'JSON',
	'Date',
	'isNaN',
	'isFinite',
	'parseFloat',
	'parseInt'
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;
const OPERATOR = /[+\-*/%=<>!&|^~?:.,;(){}[\]]/;

/**
 * JavaScript, as a flat run of tokens.
 *
 * Exported separately from the markup so the tokeniser can be tested for what
 * it recognises without asserting on HTML.
 */
export function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	const push = (kind: TokenKind, text: string) => {
		const last = tokens.at(-1);
		if (last?.kind === kind) last.text += text;
		else tokens.push({ kind, text });
	};

	while (i < source.length) {
		const ch = source[i];
		const next = source[i + 1];

		// Comments
		if (ch === '/' && next === '/') {
			const end = source.indexOf('\n', i);
			const stop = end === -1 ? source.length : end;
			push('comment', source.slice(i, stop));
			i = stop;
			continue;
		}
		if (ch === '/' && next === '*') {
			const end = source.indexOf('*/', i + 2);
			const stop = end === -1 ? source.length : end + 2;
			push('comment', source.slice(i, stop));
			i = stop;
			continue;
		}

		// Strings, including templates. Escapes are consumed so a closing quote
		// inside one does not end the run early.
		if (ch === '"' || ch === "'" || ch === '`') {
			let j = i + 1;
			while (j < source.length) {
				if (source[j] === '\\') {
					j += 2;
					continue;
				}
				if (source[j] === ch) {
					j++;
					break;
				}
				j++;
			}
			push('string', source.slice(i, j));
			i = j;
			continue;
		}

		// Numbers
		if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(next ?? ''))) {
			let j = i;
			while (j < source.length && /[0-9._eExXa-fA-F+-]/.test(source[j])) {
				// A sign only continues a number directly after an exponent.
				if ((source[j] === '+' || source[j] === '-') && !/[eE]/.test(source[j - 1] ?? '')) break;
				j++;
			}
			push('number', source.slice(i, j));
			i = j;
			continue;
		}

		// Identifiers
		if (IDENT_START.test(ch)) {
			let j = i;
			while (j < source.length && IDENT_PART.test(source[j])) j++;
			const word = source.slice(i, j);
			const afterDot = tokens.at(-1)?.kind === 'operator' && tokens.at(-1)?.text.endsWith('.');

			if (KEYWORDS.has(word)) push('keyword', word);
			else if (afterDot) push('property', word);
			else if (BUILTINS.has(word)) push('builtin', word);
			else push('plain', word);
			i = j;
			continue;
		}

		if (OPERATOR.test(ch)) {
			push('operator', ch);
			i++;
			continue;
		}

		push('plain', ch);
		i++;
	}

	return tokens;
}

/** Tailwind classes per token kind. Plain text inherits the block's colour. */
const CLASSES: Record<TokenKind, string> = {
	comment: 'text-muted-foreground/70 italic',
	string: 'text-chart-2',
	number: 'text-chart-1',
	keyword: 'text-accent-ink',
	builtin: 'text-chart-3',
	property: 'text-foreground/80',
	operator: 'text-muted-foreground',
	plain: ''
};

/**
 * The class for a token kind.
 *
 * The colouring is applied by rendering the tokens as elements rather than by
 * building a string of HTML. Svelte escapes text in a template, so there is no
 * `{@html}` here and no way for the source being displayed to become markup —
 * which for code the agent wrote and this application then executes is the
 * only sensible arrangement.
 */
export const tokenClass = (kind: TokenKind): string => CLASSES[kind];
