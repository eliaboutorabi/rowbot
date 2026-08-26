/**
 * The name of the library's load, so it can be asked to run again.
 *
 * The list of projects is layout data — the rail's recent-projects panel needs
 * it from inside a workspace, not just on `/documents` — and layout data
 * survives every navigation that does not change what its load depends on.
 * That load depends on nothing, so without a name it would be fetched once per
 * session and never refreshed.
 *
 * Import this on both sides rather than writing the string twice: a typo in an
 * invalidation key fails silently, and the failure looks exactly like the bug
 * it was meant to fix.
 */
export const LIBRARY = 'rowbot:library';
