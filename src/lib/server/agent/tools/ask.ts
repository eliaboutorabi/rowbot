/**
 * `ask_user` — the agent stops and waits for a person.
 *
 * Rowbot's whole argument is that you should be able to trust the workbook,
 * and the honest response to a genuine ambiguity is not a confident guess with
 * a footnote. It is a question. `interrupt()` suspends the graph mid-run; the
 * checkpointer holds everything that has happened so far, and the answer
 * arrives as the return value of this call when the run resumes — possibly in
 * a different serverless invocation, minutes later.
 *
 * Deliberately narrow. An agent that asks about everything is worse than one
 * that asks about nothing, so the prompt restricts this to decisions that
 * change the data and cannot be settled from the page.
 */
import { tool } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';
import { z } from 'zod';

const schema = z.object({
	question: z
		.string()
		.describe(
			'The decision you need, in one sentence, phrased for someone who knows the document.'
		),
	context: z
		.string()
		.optional()
		.describe(
			'What you saw that made this ambiguous — the sheet, the cells, the two readings you are choosing between.'
		),
	options: z
		.array(
			z.object({
				value: z.string().describe('Short token you will act on, e.g. "merge" or "day-first".'),
				label: z.string().describe('Button text, a few words.'),
				detail: z.string().optional().describe('One line on what happens if this is chosen.')
			})
		)
		.min(2)
		.max(4)
		.optional()
		.describe('Concrete choices. Offer these whenever the answer is one of a known few.'),
	defaultChoice: z
		.string()
		.optional()
		.describe(
			'The option value you would pick unprompted. Used if the reviewer skips the question.'
		)
});

export const askUserTool = tool(
	async ({ question, context, options, defaultChoice }) => {
		// Suspends here. On resume this returns whatever the client sent back.
		const answer = interrupt({
			kind: 'ask',
			question,
			context,
			options,
			defaultChoice
		});

		const reply = typeof answer === 'string' ? answer.trim() : JSON.stringify(answer);
		if (!reply || reply === 'null' || reply === 'undefined') {
			return defaultChoice
				? `The reviewer skipped the question. Proceed with "${defaultChoice}" and note it in the sheet.`
				: 'The reviewer skipped the question. Make the conservative choice and note it in the sheet.';
		}

		return `The reviewer answered: ${reply}`;
	},
	{
		name: 'ask_user',
		description:
			'Pause the run and ask the reviewer a question, then continue with their answer. Use this only for a decision that changes the data and cannot be settled from the document itself — an ambiguous date order, whether two similar tables are one table, a total that will not reconcile whichever way you read it. Do not use it for anything you can determine by reading the page again, and never for permission to continue.',
		schema
	}
);
