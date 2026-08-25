/**
 * The models Rowbot runs on, and the reasoning-effort dial exposed in the UI.
 *
 * Effort is the lever that actually changes behaviour here: a clean digital
 * PDF needs almost no deliberation, while a skewed phone photo of a merged
 * financial table rewards a lot of it.
 */

export const MODEL_IDS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface ModelInfo {
	id: ModelId;
	/** Short name for the picker. */
	label: string;
	/** One line of guidance shown under the name. */
	blurb: string;
}

export const MODELS: readonly ModelInfo[] = [
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
];

export interface EffortInfo {
	id: Effort;
	label: string;
	blurb: string;
}

export const EFFORT_INFO: readonly EffortInfo[] = [
	{ id: 'none', label: 'None', blurb: 'No deliberation. Fastest, least careful.' },
	{ id: 'low', label: 'Low', blurb: 'A quick pass. Clean tables only.' },
	{ id: 'medium', label: 'Medium', blurb: 'Balanced. The sensible default.' },
	{ id: 'high', label: 'High', blurb: 'Checks its own work on tricky layouts.' },
	{ id: 'xhigh', label: 'Extra high', blurb: 'Slow and thorough. Poor scans.' },
	{ id: 'max', label: 'Max', blurb: 'Everything it has. Expect a long wait.' }
];

export const DEFAULT_MODEL: ModelId = 'gpt-5.6-terra';
export const DEFAULT_EFFORT: Effort = 'medium';

export function isModelId(value: unknown): value is ModelId {
	return typeof value === 'string' && (MODEL_IDS as readonly string[]).includes(value);
}

export function isEffort(value: unknown): value is Effort {
	return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value);
}

export function asModelId(value: unknown): ModelId {
	return isModelId(value) ? value : DEFAULT_MODEL;
}

export function asEffort(value: unknown): Effort {
	return isEffort(value) ? value : DEFAULT_EFFORT;
}

export function modelLabel(id: string): string {
	return MODELS.find((m) => m.id === id)?.label ?? id;
}
