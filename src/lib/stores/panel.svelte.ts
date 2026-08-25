/**
 * Whether the conversation column is collapsed.
 *
 * Shared because the control that toggles it lives in the nav bar and the
 * column it toggles lives inside the workspace, two components with no
 * relationship to thread a prop through. It is deliberately not persisted: a
 * collapsed panel is a thing you do to get a wide sheet for a minute, not a
 * preference you want to find again tomorrow having forgotten you set it.
 */
class ChatPanel {
	collapsed = $state(false);

	toggle() {
		this.collapsed = !this.collapsed;
	}
}

export const chatPanel = new ChatPanel();
