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

interface Block {
	type: 'p' | 'ul' | 'ol' | 'h';
	lines: string[];
}

export function renderMarkdown(source: string): string {
	const escaped = escapeHtml(source);
	const blocks: Block[] = [];

	for (const raw of escaped.split('\n')) {
		const line = raw.trimEnd();
		const previous = blocks.at(-1);

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
 * Inline-only rendering, for places that already have their own block element
 * — an interrupt's question, an option's consequence. `renderMarkdown` wraps
 * everything in `<p>`, which nests badly inside a `<p>` and brings margins
 * that fight the surrounding layout.
 */
export function renderInline(source: string): string {
	return inline(escapeHtml(source));
}
