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

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Inline spans, applied to already-escaped text. */
function inline(text: string): string {
	return (
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
