/**
 * Turning a run failure into something a reviewer can read.
 *
 * The agent runs on a graph and talks to three APIs, and when one of them
 * fails the string that comes back is written for whoever wrote the library:
 * a stack of channel names, a JSON dump of the update that was rejected, a
 * docs URL. Printed straight into the panel that was three thousand
 * characters of it, which pushed the conversation off the top of the screen
 * and told the reviewer nothing they could act on.
 *
 * So: a plain headline, whether it is worth trying again, and the original
 * text kept intact behind a disclosure for when it actually matters.
 */

export interface RunFailure {
	/** One sentence, plain language, no jargon. */
	title: string;
	/** What to do about it, when there is something. */
	hint?: string;
	/** The original message, or null when the title already is it. */
	detail: string | null;
	/**
	 * Whether sending the same turn again stands a real chance. The thread is
	 * checkpointed and repaired before every turn, so a crashed step is not a
	 * dead end — but a spent allowance or a rejected key is, and offering to
	 * retry those is just a button that fails twice.
	 */
	retryable: boolean;
}

/** A first sentence, capped — the raw text can be thousands of characters. */
function headline(raw: string): string {
	const first = raw.split(/(?<=[.!?])\s|\n/)[0].trim();
	const text = first || raw.trim();
	return text.length > 140 ? `${text.slice(0, 137).trimEnd()}…` : text;
}

export function describeRunFailure(raw: string): RunFailure {
	const text = raw.trim();
	const lower = text.toLowerCase();

	// LangGraph rejecting two writes to one channel in a single step. The model
	// called the same tool twice in parallel, which is a reasonable thing for it
	// to do and entirely our problem to absorb.
	if (
		lower.includes('invalid_concurrent_graph_update') ||
		lower.includes('can only receive one value per step') ||
		lower.includes('invalid update for channel')
	) {
		return {
			title: 'Rowbot tried to do two things at once and lost track of one of them.',
			hint: 'Nothing you did caused this, and anything already built is still here.',
			detail: text,
			retryable: true
		};
	}

	// The reader, not the document. Worth saying, because "Mistral OCR failed"
	// reads like the file was the problem.
	if (lower.includes('mistral') || lower.includes('could not reach')) {
		return {
			title: 'The document reader is having a bad minute.',
			hint: 'Rowbot already waited and tried again. Give it a moment and send your message again — the file is fine.',
			detail: text,
			retryable: true
		};
	}

	if (lower.includes('rate limit') || lower.includes('429')) {
		return {
			title: 'The model provider is rate limiting this account.',
			hint: 'Wait a minute before trying again.',
			detail: text,
			retryable: true
		};
	}

	if (lower.includes('aborterror') || lower.includes('network') || lower.includes('fetch failed')) {
		return {
			title: 'The connection to Rowbot dropped mid-run.',
			hint: 'Anything already built is saved, and the run picks up from where it stopped.',
			detail: text,
			retryable: true
		};
	}

	if (lower.includes('recursion') || lower.includes('graph_recursion_limit')) {
		return {
			title: 'Rowbot ran for too many steps without finishing.',
			hint: 'Ask for a smaller piece of the job — one sheet, or one page range at a time.',
			detail: text,
			retryable: false
		};
	}

	const short = headline(text);
	return { title: short, detail: short === text ? null : text, retryable: true };
}
