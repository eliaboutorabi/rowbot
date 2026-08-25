import { describe, expect, it } from 'vitest';
import { sidebar } from './sidebar.svelte';

/** The store is a singleton, so each case puts it back where it started. */
function reset() {
	sidebar.open = 'chat';
	sidebar.toggle('chat');
	sidebar.toggle('chat');
}

describe('sidebar', () => {
	it('opens on the conversation', () => {
		reset();
		expect(sidebar.open).toBe('chat');
	});

	it('hands the space back to the conversation when settings closes', () => {
		reset();
		sidebar.toggle('settings');
		expect(sidebar.open).toBe('settings');
		sidebar.toggle('settings');
		expect(sidebar.open).toBe('chat');
	});

	it('leaves the sheet at full width when the conversation was already hidden', () => {
		// Both dismissals were deliberate, so neither should be undone by the
		// other: closing settings must not re-open a panel you had put away.
		reset();
		sidebar.toggle('chat');
		sidebar.toggle('settings');
		sidebar.toggle('settings');
		expect(sidebar.open).toBeNull();
	});

	it('swaps straight between two overlay panels', () => {
		reset();
		sidebar.toggle('projects');
		sidebar.toggle('settings');
		expect(sidebar.open).toBe('settings');
		// And still remembers the conversation underneath both of them.
		sidebar.toggle('settings');
		expect(sidebar.open).toBe('chat');
	});

	it('reopens the conversation after it was dismissed', () => {
		reset();
		sidebar.toggle('chat');
		expect(sidebar.open).toBeNull();
		sidebar.toggle('chat');
		expect(sidebar.open).toBe('chat');
		sidebar.toggle('settings');
		sidebar.toggle('settings');
		expect(sidebar.open).toBe('chat');
	});
});
