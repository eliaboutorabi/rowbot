/**
 * A deliberately tiny Markdown renderer for the agent's prose.
 *
 * The agent writes short summaries with bold, lists, inline code and the
 * occasional heading — nothing more. Pulling in a full parser (and a
 * sanitiser to make it safe) would cost more than it is worth, so this
 * handles that subset and escapes everything else.
 *
 * Model output is untrusted input: every character is HTML-escaped *before*
 * any markup is generated, so no tag in the source text can survive.
 */

import { parseRef, refLabel } from './sheet-ref';

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * `[[Sheet!B3]]` becomes a clickable chip.
 *
 * The agent is told to write these when it refers to a place in the workbook,
 * so "the total in [[Revenue!F7]] does not reconcile" lands you on that cell
 * instead of leaving you to find it. Rendered as a `data-ref` button and
 * handled by delegation on the container: this HTML is injected with `@html`,
 * so there is no component here to attach a listener to.
 *
 * The reference is validated before it becomes a button. Anything malformed
 * stays as the literal text the model wrote, because a chip that goes nowhere
 * is worse than no chip.
 */
function references(text: string): string {
	return text.replace(/\[\[([^\]\n]{1,120})\]\]/g, (whole, body: string) => {
		// The text arrives HTML-escaped, so a quoted sheet name is &#39;…&#39;.
		const ref = parseRef(
			body
				.replace(/&#39;/g, "'")
				.replace(/&quot;/g, '"')
				.replace(/&amp;/g, '&')
		);
		if (!ref) return whole;

		return (
			`<button type="button" data-ref="${ref.raw}" ` +
			'class="mx-px inline-flex items-baseline gap-1 rounded-md bg-primary/10 px-1.5 py-px align-baseline ' +
			'font-mono text-[0.82em] text-accent-ink transition-colors hover:bg-primary/20 ' +
			'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">' +
			`${escapeHtml(refLabel(ref))}</button>`
		);
	});
}

/** Inline spans, applied to already-escaped text. */
function inline(text: string): string {
	return references(
		text
			// `code`
			.replace(
				/`([^`]+)`/g,
				'<code class="rounded bg-muted px-1 py-px font-mono text-[0.85em]">$1</code>'
			)
			// **bold**
			.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold">$1</strong>')
			// *italic* / _italic_, but not inside words like snake_case
			.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '<em>$1</em>')
			.replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, '<em>$1</em>')
	);
}

type Align = 'left' | 'center' | 'right' | null;

/**
 * One row of a pipe table, split into cells.
 *
 * The outer pipes are optional in GFM and a `\|` inside a cell is a literal
 * pipe rather than a divider, which matters here because the agent writes
 * spreadsheet references and formulas into these tables.
 */
function rowCells(line: string): string[] {
	let body = line.trim();
	if (body.startsWith('|')) body = body.slice(1);
	if (/(^|[^\\])\|$/.test(body)) body = body.slice(0, -1);
	return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

/**
 * The `|---|:--:|---:|` row, which is what makes the line above it a header.
 *
 * Returns one alignment per column, or `null` if this is not a delimiter —
 * and that `null` is the whole test for whether a line full of pipes is a
 * table at all. Prose with a stray pipe in it stays prose.
 */
function alignments(line: string): Align[] | null {
	if (!line.includes('|') || !line.includes('-')) return null;

	const cells = rowCells(line);
	if (!cells.length) return null;

	const out: Align[] = [];
	for (const cell of cells) {
		if (!/^:?-+:?$/.test(cell)) return null;
		const left = cell.startsWith(':');
		const right = cell.endsWith(':');
		out.push(right ? (left ? 'center' : 'right') : left ? 'left' : null);
	}
	return out;
}

interface Block {
	type: 'p' | 'ul' | 'ol' | 'h' | 'table';
	lines: string[];
	/** Tables only: one entry per column, from the delimiter row. */
	align?: Align[];
}

/**
 * A pipe table.
 *
 * Sized to its content rather than to the column, and allowed to scroll
 * sideways inside its own box. The conversation is 22–32rem wide and these
 * tables run to seven columns of figures; made to fit, every cell wraps onto
 * three lines and the comparison the table exists to show is lost. The
 * workbook grid beside it scrolls the same way.
 */
function table(block: Block): string {
	const align = block.align ?? [];
	const width = align.length;
	const [header, ...body] = block.lines;

	// Exactly one alignment class per cell. Emitting `text-start` alongside
	// `text-right` would leave the winner to the order Tailwind happened to
	// write the rules in, not the order they appear in the attribute.
	const side = (column: number) => {
		const at = align[column];
		return at === 'right' ? 'text-right' : at === 'center' ? 'text-center' : 'text-start';
	};

	// GFM pads a short row and drops the overflow of a long one, so a ragged
	// table still lines up under its header instead of shearing.
	const cells = (line: string) => {
		const got = rowCells(line);
		return Array.from({ length: width }, (_, column) => got[column] ?? '');
	};

	const head = cells(header)
		.map(
			(cell, column) =>
				`<th class="border-b border-border px-2 py-1 font-medium whitespace-nowrap text-muted-foreground ${side(column)}">${inline(cell)}</th>`
		)
		.join('');

	const rows = body
		.map(
			(line) =>
				`<tr>${cells(line)
					.map(
						(cell, column) =>
							`<td class="border-b border-border/40 px-2 py-1 whitespace-nowrap ${side(column)}">${inline(cell)}</td>`
					)
					.join('')}</tr>`
		)
		.join('');

	return (
		'<div class="scroll-slim my-2 overflow-x-auto rounded-lg border border-border/60">' +
		'<table class="w-max min-w-full border-collapse text-[0.92em] tabular-nums">' +
		`<thead><tr>${head}</tr></thead>` +
		(rows ? `<tbody>${rows}</tbody>` : '') +
		'</table></div>'
	);
}

export function renderMarkdown(source: string): string {
	const escaped = escapeHtml(source);
	const blocks: Block[] = [];
	const lines = escaped.split('\n');

	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index];
		const line = raw.trimEnd();
		const previous = blocks.at(-1);

		/*
		 * A table, if the next line is a delimiter row. Checked first and by
		 * lookahead, because a header row on its own is indistinguishable from
		 * a sentence containing pipes — and until this existed the agent's
		 * reconciliation tables rendered as a paragraph of pipes and dashes.
		 */
		if (line.includes('|')) {
			const align = alignments(lines[index + 1] ?? '');
			if (align) {
				const rows = [line];
				let next = index + 2;
				while (next < lines.length) {
					const candidate = lines[next].trimEnd();
					// Anything that opens a block of its own ends the table, as does
					// a blank line or a line with no cells in it.
					if (!candidate.trim() || !candidate.includes('|')) break;
					if (/^\s*([-*•]\s|\d+[.)]\s|#{1,6}\s)/.test(candidate)) break;
					rows.push(candidate);
					next++;
				}
				blocks.push({ type: 'table', lines: rows, align });
				index = next - 1;
				continue;
			}
		}

		if (!line.trim()) {
			// A blank line closes whatever block was open.
			if (previous) blocks.push({ type: 'p', lines: [] });
			continue;
		}

		const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
		if (bullet) {
			if (previous?.type === 'ul' && previous.lines.length) previous.lines.push(bullet[1]);
			else blocks.push({ type: 'ul', lines: [bullet[1]] });
			continue;
		}

		const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
		if (numbered) {
			if (previous?.type === 'ol' && previous.lines.length) previous.lines.push(numbered[1]);
			else blocks.push({ type: 'ol', lines: [numbered[1]] });
			continue;
		}

		const heading = /^#{1,6}\s+(.*)$/.exec(line);
		if (heading) {
			blocks.push({ type: 'h', lines: [heading[1]] });
			continue;
		}

		if (previous?.type === 'p' && previous.lines.length) previous.lines.push(line);
		else blocks.push({ type: 'p', lines: [line] });
	}

	return blocks
		.filter((block) => block.lines.length)
		.map((block) => {
			if (block.type === 'table') return table(block);

			const items = block.lines.map(inline);
			switch (block.type) {
				case 'ul':
					return `<ul class="my-1.5 list-disc space-y-1 pl-5">${items
						.map((i) => `<li>${i}</li>`)
						.join('')}</ul>`;
				case 'ol':
					return `<ol class="my-1.5 list-decimal space-y-1 pl-5">${items
						.map((i) => `<li>${i}</li>`)
						.join('')}</ol>`;
				case 'h':
					return `<p class="mt-2 mb-1 font-semibold">${items[0]}</p>`;
				default:
					return `<p class="my-1.5">${items.join('<br />')}</p>`;
			}
		})
		.join('');
}

/**
 * References, and nothing else.
 *
 * For text a person typed. Their prose is not markdown and should not be read
 * as any — someone who types an asterisk means an asterisk — but the `[[…]]`
 * syntax is the app's own, put there by the composer when they attached a
 * row or a column, and showing it to them raw is showing them the wire
 * format. So: escape everything, then turn the references into the same chips
 * the agent's replies get.
 */
export function renderReferences(source: string): string {
	return references(escapeHtml(source));
}

/**
 * Inline-only rendering, for places that already have their own block element
 * — an interrupt's question, an option's consequence. `renderMarkdown` wraps
 * everything in `<p>`, which nests badly inside a `<p>` and brings margins
 * that fight the surrounding layout.
 */
export function renderInline(source: string): string {
	return inline(escapeHtml(source));
}
