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
export type SidebarPanel = 'chat' | 'projects' | 'settings' | 'account';

class Sidebar {
	open = $state<SidebarPanel | null>('chat');

	/**
	 * Whether the conversation should come back when an overlay panel closes.
	 *
	 * True to begin with, because it starts open. It only goes false when the
	 * conversation is deliberately dismissed — so closing settings hands the
	 * space back to what you were reading, and closing settings *after* you had
	 * already hidden the conversation leaves the sheet at full width, which is
	 * what you asked for both times.
	 */
	#restoreChat = true;

	toggle(panel: SidebarPanel) {
		if (panel === 'chat') {
			const closing = this.open === 'chat';
			this.#restoreChat = !closing;
			this.open = closing ? null : 'chat';
			return;
		}

		this.open = this.open === panel ? (this.#restoreChat ? 'chat' : null) : panel;
	}

	close() {
		this.open = null;
		this.#restoreChat = false;
	}
}

export const sidebar = new Sidebar();
