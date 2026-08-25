/**
 * Builds the Rowbot deep agent.
 *
 * The harness is Deep Agents: planning, a virtual filesystem, subagent
 * delegation and human interrupts come from the framework, so what lives here
 * is the domain — the model, the tools, and the persistence that lets a run
 * be paused and resumed.
 */
import { createDeepAgent, StateBackend } from 'deepagents';
import { createAgent, todoListMiddleware } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { openaiKey } from '$lib/server/provider-keys';
import { checkpointer } from './checkpointer';
import { rowbotContextSchema, rowbotStateSchema, type RowbotContext } from './state';
import { systemPrompt } from './prompt';
import { askUserTool } from './tools/ask';
import { ocrDocumentTool } from './tools/ocr';
import { checkTotalsTool } from './tools/totals';
import { readSheetTool, workbookTools } from './tools/workbook';
import { DEFAULT_EFFORT, DEFAULT_MODEL, type Effort, type ModelId } from './models';

export interface AgentOptions {
	model?: ModelId;
	effort?: Effort;
	context: RowbotContext;
}

export function chatModel(model: ModelId, effort: Effort): ChatOpenAI {
	return new ChatOpenAI({
		model,
		apiKey: openaiKey(),
		useResponsesApi: true,
		// `xhigh` and `max` are newer than the bundled SDK's union type.
		reasoning: { effort: effort as 'low' | 'medium' | 'high' },
		streaming: true
	});
}

const AUDITOR_PROMPT = `You audit one spreadsheet sheet against the page it was extracted from.

Read the sheet with \`read_sheet\` (pass its name). The source pages are in the workspace as /source/page-N.md.

Check, in order:
1. Every Total / Subtotal / Sum row and column — does the arithmetic actually hold?
2. Header rows — does the sheet's header match the page's, including any second row?
3. Numeric columns — is anything stuck as text that should be a number?
4. Any value that differs from what the page says.

Report findings as a short list. For each problem give the exact row and column indices and the corrected value. Do not fix anything yourself — the main agent applies the corrections. If the sheet is clean, say so in one line.`;

/**
 * A reviewer that runs in its own context window, so thousands of raw cell
 * values never enter the main thread.
 *
 * It is compiled here rather than declared as a plain spec because a
 * declarative subagent is built without the parent's `stateSchema` — its
 * `workbook` channel would not exist, and the auditor would open every sheet
 * to find an empty workbook.
 */
export function auditorSubagent(model: ChatOpenAI) {
	return {
		name: 'sheet-auditor',
		description:
			'Verifies one finished sheet against the page it came from. Use it after importing a sheet that has totals, merged headers, or several numeric columns. Name the sheet in the task description.',
		// Only the read path: the auditor reports, the main agent applies fixes.
		runnable: createAgent({
			name: 'sheet-auditor',
			model,
			systemPrompt: AUDITOR_PROMPT,
			stateSchema: rowbotStateSchema,
			contextSchema: rowbotContextSchema,
			tools: [readSheetTool]
		})
	};
}

export function createRowbotAgent(options: AgentOptions) {
	const modelId = options.model ?? DEFAULT_MODEL;
	const effort = options.effort ?? DEFAULT_EFFORT;
	const model = chatModel(modelId, effort);

	return createDeepAgent({
		name: 'rowbot',
		model,
		tools: [ocrDocumentTool, ...workbookTools, checkTotalsTool, askUserTool],
		systemPrompt: systemPrompt(options.context),
		stateSchema: rowbotStateSchema,
		contextSchema: rowbotContextSchema,
		middleware: [todoListMiddleware()],
		subagents: [auditorSubagent(model)],
		// The virtual filesystem lives in graph state: there is no durable disk
		// on Vercel, and this way the OCR output is checkpointed with everything
		// else and survives an interrupted run.
		backend: new StateBackend(),
		checkpointer: checkpointer()
	});
}

export type RowbotAgent = ReturnType<typeof createRowbotAgent>;
