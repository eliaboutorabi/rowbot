import { describe, expect, it, vi } from 'vitest';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { danglingToolCalls, healThread } from './heal';

const asked = (...ids: string[]) =>
	new AIMessage({
		content: '',
		tool_calls: ids.map((id) => ({ id, name: 'ocr_document', args: {} }))
	});

const answered = (id: string) =>
	new ToolMessage({ tool_call_id: id, name: 'ocr_document', content: 'done' });

function thread(messages: unknown[], interrupts = 0) {
	return {
		getState: vi.fn(async () => ({
			values: { messages },
			tasks: interrupts ? [{ interrupts: [{ value: 'which date format?' }] }] : []
		})),
		updateState: vi.fn(async () => undefined)
	};
}

describe('danglingToolCalls', () => {
	it('finds nothing in a thread where every call was answered', () => {
		expect(danglingToolCalls([asked('a', 'b'), answered('a'), answered('b')])).toEqual([]);
	});

	it('finds the calls a crashed tool step never answered', () => {
		// The shape the concurrent-update crash leaves behind: the assistant
		// message was committed, both tool results were discarded with the step.
		expect(danglingToolCalls([asked('a', 'b')]).map((c) => c.id)).toEqual(['a', 'b']);
	});

	it('ignores a call that a later message answered out of order', () => {
		expect(danglingToolCalls([asked('a'), asked('b'), answered('b')]).map((c) => c.id)).toEqual([
			'a'
		]);
	});
});

describe('healThread', () => {
	it('answers the open calls so the next turn has a valid history', async () => {
		const agent = thread([asked('a', 'b')]);

		expect(await healThread(agent, 't1')).toBe(2);

		const [, values] = agent.updateState.mock.calls[0] as unknown as [
			unknown,
			{ messages: ToolMessage[] }
		];
		expect(values.messages.map((m) => m.tool_call_id)).toEqual(['a', 'b']);
		expect(values.messages[0].content).toMatch(/did not finish/i);
	});

	it('leaves a healthy thread alone', async () => {
		const agent = thread([asked('a'), answered('a')]);

		expect(await healThread(agent, 't1')).toBe(0);
		expect(agent.updateState).not.toHaveBeenCalled();
	});

	it('leaves a thread suspended on a question alone', async () => {
		// `ask_user` also parks an unanswered tool call — but that one is alive
		// and waiting for the reviewer, and closing it off would discard the run.
		const agent = thread([asked('a')], 1);

		expect(await healThread(agent, 't1')).toBe(0);
		expect(agent.updateState).not.toHaveBeenCalled();
	});

	it('never stops a run because the checkpoint could not be read', async () => {
		const agent = {
			getState: vi.fn(async () => {
				throw new Error('no checkpoint');
			}),
			updateState: vi.fn(async () => undefined)
		};

		await expect(healThread(agent, 't1')).resolves.toBe(0);
	});
});
