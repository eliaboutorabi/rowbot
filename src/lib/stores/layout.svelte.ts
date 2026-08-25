/**
 * How wide the two side columns are.
 *
 * Unlike which panel is open, this *is* a preference: someone who wants a
 * narrow conversation and a wide sheet wants that tomorrow too. So it is
 * remembered, per column, and clamped on the way in and out — a width read
 * back from storage has to survive a smaller screen than the one it was set
 * on, and a drag has to stop somewhere on both sides.
 */
const LIMITS = {
	/** The conversation. Below ~19rem the agent's prose wraps to four words a line. */
	chat: { min: 300, max: 720, fallback: 448 },
	/** Projects, settings, the account. Narrower jobs, so a narrower floor. */
	panel: { min: 240, max: 560, fallback: 320 }
} as const;

export type Column = keyof typeof LIMITS;

const clamp = (column: Column, value: number) =>
	Math.round(Math.min(Math.max(value, LIMITS[column].min), LIMITS[column].max));

function stored(column: Column): number {
	const { fallback } = LIMITS[column];
	if (typeof localStorage === 'undefined') return fallback;
	const saved = Number(localStorage.getItem(`rowbot:width:${column}`));
	return Number.isFinite(saved) && saved > 0 ? clamp(column, saved) : fallback;
}

class Widths {
	chat = $state<number>(LIMITS.chat.fallback);
	panel = $state<number>(LIMITS.panel.fallback);

	/**
	 * Read from storage after mount rather than at construction: this module is
	 * imported during server rendering, where `localStorage` does not exist,
	 * and a width that differed between the server's HTML and the browser's
	 * first paint would show up as the column jumping on load.
	 */
	hydrate() {
		this.chat = stored('chat');
		this.panel = stored('panel');
	}

	limits(column: Column) {
		return LIMITS[column];
	}

	set(column: Column, value: number) {
		const next = clamp(column, value);
		this[column] = next;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(`rowbot:width:${column}`, String(next));
		}
	}
}

export const widths = new Widths();
