/**
 * What the agent is doing, for the rail to show.
 *
 * The conversation panel used to collapse into a rail of its own carrying
 * three things: whether Rowbot is working, how far through its plan it is, and
 * what it last did. Now that the app has one rail, a second one beside it
 * would be two columns of icons before the sheet even starts — so those three
 * facts ride on the rail's conversation button instead.
 *
 * A store rather than a prop because the button lives in the layout and the
 * run lives inside the workspace, two components with no relationship to
 * thread anything through.
 */
class Activity {
	busy = $state(false);
	failed = $state(false);
	/** Plan steps completed and total, or zero when there is no plan. */
	done = $state(0);
	total = $state(0);

	report(next: { busy: boolean; failed: boolean; done: number; total: number }) {
		this.busy = next.busy;
		this.failed = next.failed;
		this.done = next.done;
		this.total = next.total;
	}

	clear() {
		this.report({ busy: false, failed: false, done: 0, total: 0 });
	}
}

export const activity = new Activity();
