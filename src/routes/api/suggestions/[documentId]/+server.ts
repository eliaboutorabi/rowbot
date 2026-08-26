/**
 * Three things worth asking next, for this workbook.
 *
 * The follow-ups under a finished run were a fixed list, which is fine until
 * you read them: "re-check against the pages" on a workbook whose every figure
 * already reconciles is noise, and the one thing actually worth asking about —
 * the figure the reader was unsure of, the column nobody needs — was never
 * offered because a fixed list cannot know about it.
 *
 * So they are written for the workbook in front of you, from its sheets, its
 * notes and whatever the agent flagged. Its own small request rather than part
 * of the run: it must not delay the answer, and a failure here should cost
 * nothing more than the chips not appearing.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { latestRun, latestWorkbook, ownedDocument } from '$lib/server/runs';
import { chatModel } from '$lib/server/agent';
import { readTranscript } from '$lib/server/agent/transcript';
import type { WorkbookModel } from '$lib/types/workbook';

/** The icons the client can draw. The model picks from these, not free-form. */
const KINDS = ['check', 'explain', 'edit', 'export'] as const;

const shape = z.object({
	suggestions: z
		.array(
			z.object({
				label: z.string().min(3).max(46),
				prompt: z.string().min(10).max(400),
				kind: z.enum(KINDS)
			})
		)
		.max(3)
});

/** What the model is shown: the shape of the workbook, not its every cell. */
function describe(model: WorkbookModel): string {
	const sheets = model.sheets
		.map((sheet) => {
			const columns = sheet.columns.map((column) => column.label ?? column.key).join(', ');
			const flagged = sheet.rows
				.flat()
				.filter((cell) => cell.check?.status === 'mismatch')
				.map((cell) => cell.check?.message)
				.slice(0, 3);
			const unsure = sheet.rows.flat().filter((cell) => (cell.conf ?? 1) < 0.9).length;

			return [
				`- "${sheet.name}": ${Math.max(sheet.rows.length - sheet.headerRows, 0)} rows`,
				columns && ` [${columns}]`,
				unsure && `, ${unsure} cells the reader was unsure of`,
				flagged.length && `, mismatches: ${flagged.join('; ')}`,
				sheet.notes && `, note: ${sheet.notes.slice(0, 200)}`
			]
				.filter(Boolean)
				.join('');
		})
		.join('\n');

	return [`Workbook: ${model.title}`, sheets, model.notes && `Notes: ${model.notes.slice(0, 700)}`]
		.filter(Boolean)
		.join('\n');
}

const INSTRUCTIONS = `You suggest the next thing a reviewer might ask about a spreadsheet
that was just extracted from a scanned document.

Write at most three. Each is a button, so:
- label: what the button says. Under six words, sentence case, no full stop.
- prompt: the message sent if it is clicked, written as the reviewer would type it.
- kind: "check" to verify figures, "explain" to ask about the working, "edit" to
  change the workbook, "export" to prepare it for someone else.

Be specific to this workbook. Name the sheet, the column or the figure where that
helps — "Check the 5% discount lines" beats "Check the numbers". Prefer what the
notes flag as uncertain or wrong. Do not suggest anything the notes say is already
done, and do not suggest downloading the file: there is a button for that.

One worth offering when the workbook is only tables and the document plainly had
more on it — a letterhead, an invoice number, an address, payment terms — is
pulling those into a separate "Details" sheet. Word it as the reviewer would:
"Pull the invoice details into a sheet".`;

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Sign in first.');

	const doc = await ownedDocument(params.documentId, locals.user.id);
	const saved = await latestWorkbook(doc.id);
	if (!saved) return json({ suggestions: [] });

	const model = saved.dataJson as WorkbookModel;

	// The last thing the agent said, which is usually where the loose ends are.
	let closing = '';
	try {
		const run = await latestRun(doc.id);
		const transcript = run ? await readTranscript(run.threadId) : null;
		closing =
			[...(transcript?.items ?? [])]
				.reverse()
				.find((item) => item.kind === 'assistant')
				?.text?.slice(0, 900) ?? '';
	} catch {
		// A transcript that will not load is not a reason to have no suggestions.
	}

	try {
		const llm = chatModel('gpt-5.6-sol', 'none').withStructuredOutput(shape);
		const reply = await llm.invoke([
			{ role: 'system', content: INSTRUCTIONS },
			{
				role: 'user',
				content: [describe(model), closing && `\nThe agent finished by saying:\n${closing}`]
					.filter(Boolean)
					.join('\n')
			}
		]);
		return json(shape.parse(reply));
	} catch (cause) {
		// Never an error to the client. The chips are a nicety and the composer
		// is right there; a failed suggestion call should be invisible.
		console.error('[rowbot] could not write suggestions', cause);
		return json({ suggestions: [] });
	}
};
