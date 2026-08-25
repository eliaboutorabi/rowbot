/**
 * Marks a scroller while it is being scrolled.
 *
 * The scrollbar is transparent at rest and CSS can reveal it on hover and on
 * focus, but not on the signal that matters most: that you are scrolling right
 * now. A native overlay scrollbar appears the moment the content moves and
 * fades once it stops, and without that a hidden bar costs you your position
 * in a four-thousand-row ledger. This supplies the missing state as a
 * `data-scrolling` attribute for `.scroll-slim` to key off.
 *
 * One listener for the whole document rather than one per component. `scroll`
 * does not bubble, but it does capture, so a single capturing listener at the
 * root sees every scroller — including ones mounted later, which a per-element
 * approach would have to chase.
 */

/** Long enough to read as "still scrolling" through a pause, short enough to feel automatic. */
const LINGER_MS = 900;

export function trackScrolling(): () => void {
	const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

	function onScroll(event: Event) {
		const target = event.target;
		if (!(target instanceof Element)) return;
		// Only surfaces that opted into the styling; everything else is either
		// the page itself or a scroller that wants its native bar.
		if (!target.classList.contains('scroll-slim')) return;

		target.setAttribute('data-scrolling', '');
		clearTimeout(timers.get(target));
		timers.set(
			target,
			setTimeout(() => {
				// Leave it up while the pointer is still over the surface — removing
				// it there would fight the `:hover` rule and flicker.
				if (!target.matches(':hover')) target.removeAttribute('data-scrolling');
				timers.delete(target);
			}, LINGER_MS)
		);
	}

	document.addEventListener('scroll', onScroll, { capture: true, passive: true });
	return () => document.removeEventListener('scroll', onScroll, { capture: true });
}
