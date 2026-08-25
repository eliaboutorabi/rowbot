/**
 * Client-safe copy of the model registry. `$lib/server/agent/models` cannot be
 * imported in the browser, and the picker needs the same list.
 */
export const MODELS = [
	{
		id: 'gpt-5.6-sol',
		label: 'Sol',
		blurb: 'Quickest to answer. Good for clean, born-digital PDFs.'
	},
	{
		id: 'gpt-5.6-terra',
		label: 'Terra',
		blurb: 'The default. Handles most scans and merged headers well.'
	},
	{
		id: 'gpt-5.6-luna',
		label: 'Luna',
		blurb: 'Deliberates the longest. Reach for it on messy or dense pages.'
	}
] as const;

export const EFFORTS = [
	{ id: 'none', label: 'None', blurb: 'No deliberation. Fastest, least careful.' },
	{ id: 'low', label: 'Low', blurb: 'A quick pass. Clean tables only.' },
	{ id: 'medium', label: 'Medium', blurb: 'Balanced. The sensible default.' },
	{ id: 'high', label: 'High', blurb: 'Checks its own work on tricky layouts.' },
	{ id: 'xhigh', label: 'Extra high', blurb: 'Slow and thorough. Poor scans.' },
	{ id: 'max', label: 'Max', blurb: 'Everything it has. Expect a long wait.' }
] as const;

export type ModelId = (typeof MODELS)[number]['id'];
export type EffortId = (typeof EFFORTS)[number]['id'];

export const DEFAULT_MODEL: ModelId = 'gpt-5.6-terra';
export const DEFAULT_EFFORT: EffortId = 'medium';

export const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;
export const effortLabel = (id: string) => EFFORTS.find((e) => e.id === id)?.label ?? id;
