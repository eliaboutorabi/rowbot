/**
 * The walkthrough, in one place.
 *
 * Two surfaces show it and they must not disagree: the phone landing page
 * embeds it, because somebody who cannot run the app should still get to see
 * what it does, and the desktop header links to it.
 *
 * `youtube-nocookie.com` rather than `youtube.com`: the embed sets no tracking
 * cookie until the viewer actually presses play, which is the polite default
 * for a page nobody asked to be measured on.
 */
export const VIDEO_ID = 'sFGWTywSG4c';

/** Where to send someone who wants to watch it on YouTube itself. */
export const VIDEO_URL = `https://youtu.be/${VIDEO_ID}`;

/** The privacy-preserving embed, for an iframe. */
export const VIDEO_EMBED = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=0`;

export const VIDEO_TITLE = 'Rowbot — a walkthrough';
