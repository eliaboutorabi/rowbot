import { describe, expect, it } from 'vitest';
import { tokenClass, tokenize } from './highlight';

const kinds = (source: string) => tokenize(source).map((t) => `${t.kind}:${t.text}`);

describe('tokenize', () => {
	it('marks keywords, and does not mark words that merely contain one', () => {
		// Adjacent runs of one kind are merged, so the space joins the word after
		// it: fewer spans for the same colouring.
		expect(kinds('const constant')).toEqual(['keyword:const', 'plain: constant']);
	});

	it('reads a string to its closing quote and no further', () => {
		expect(
			tokenize(`'a' + 'b'`)
				.filter((t) => t.kind === 'string')
				.map((t) => t.text)
		).toEqual(["'a'", "'b'"]);
	});

	it('does not end a string on an escaped quote', () => {
		expect(tokenize(`'it\\'s'`)[0]).toEqual({ kind: 'string', text: `'it\\'s'` });
	});

	it('takes a line comment to the end of the line and not past it', () => {
		const tokens = tokenize('// note\nconst x = 1;');
		expect(tokens[0]).toEqual({ kind: 'comment', text: '// note' });
		expect(tokens.some((t) => t.kind === 'keyword' && t.text === 'const')).toBe(true);
	});

	it('handles a block comment that is never closed', () => {
		expect(tokenize('/* forever')[0].kind).toBe('comment');
	});

	it('reads a decimal as one number', () => {
		expect(tokenize('350.87').map((t) => t.text)).toEqual(['350.87']);
	});

	it('does not swallow a minus that is subtraction', () => {
		expect(
			tokenize('1 - 2')
				.filter((t) => t.kind === 'number')
				.map((t) => t.text)
		).toEqual(['1', '2']);
	});

	it('keeps an exponent together', () => {
		expect(tokenize('1e-6')[0].text).toBe('1e-6');
	});

	it('marks what the sandbox puts in scope', () => {
		expect(kinds('round(x)')[0]).toBe('builtin:round');
	});

	it('treats a name after a dot as a property, not a builtin', () => {
		const tokens = tokenize('a.Math');
		expect(tokens.at(-1)).toEqual({ kind: 'property', text: 'Math' });
	});

	it('loses nothing: the tokens rebuild the source exactly', () => {
		const source = `const s = sheets['Items'];\n// check\nreturn round(s.body[0][4] * 1.5);`;
		expect(
			tokenize(source)
				.map((t) => t.text)
				.join('')
		).toBe(source);
	});
});

describe('tokenClass', () => {
	it('gives each kind its own colour, and leaves plain text alone', () => {
		expect(tokenClass('keyword')).toBeTruthy();
		expect(tokenClass('string')).not.toBe(tokenClass('number'));
		expect(tokenClass('plain')).toBe('');
	});

	it('never has to escape anything, because nothing is built as HTML', () => {
		// The tokens are rendered as elements by the template, which escapes
		// their text; this module produces no markup at all. The guarantee is
		// that a hostile source survives tokenising as inert text.
		const source = 'const x = "<img src=x onerror=alert(1)>";';
		expect(
			tokenize(source)
				.map((t) => t.text)
				.join('')
		).toBe(source);
	});
});
