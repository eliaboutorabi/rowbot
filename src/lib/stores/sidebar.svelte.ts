/**
 * Which panel the sidebar is showing, if any.
 *
 * The app has one piece of chrome: a rail down the left with the
 * conversation, settings, the theme and the account on it. Everything that
 * used to live along the top now opens as the rail's expanded panel, which is
 * what lets the spreadsheet start at the very top of the window instead of
 * fourteen rems down.
 *
 * One panel at a time, deliberately. Two expanded columns beside a rail and a
 * sheet is four things competing for a screen, and the reason to open settings
 * is never to keep reading the conversation at the same time.
 *
 * Not persisted: which panel is open is a thing you do for a minute, not a
 * preference you want to find again tomorrow having forgotten you set it. The
 * conversation is open to begin with because in a workspace it is the point.
 */
export type SidebarPanel = 'chat' | 'settings' | 'account';

class Sidebar {
	open = $state<SidebarPanel | null>('chat');

	/** What was showing before settings or the account took the space. */
	#resume: SidebarPanel | null = 'chat';

	toggle(panel: SidebarPanel) {
		if (this.open === panel) {
			// Closing settings hands the space back to the conversation rather
			// than to nothing — you were reading it a moment ago.
			this.open = panel === 'chat' ? null : this.#resume;
			if (panel === 'chat') this.#resume = null;
			return;
		}
		if (panel !== 'chat') this.#resume = this.open === panel ? this.#resume : this.open;
		else this.#resume = 'chat';
		this.open = panel;
	}

	close() {
		this.open = null;
		this.#resume = null;
	}
}

export const sidebar = new Sidebar();
