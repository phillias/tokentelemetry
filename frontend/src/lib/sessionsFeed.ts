"use client";

/**
 * List-feed contract for GET /sessions.
 *
 * The polling list pages (dashboard, sessions list, agents, Hermes) render
 * only row fields, so they fetch the slim `?view=summary` projection instead
 * of the full payload the session detail page needs. They also poll no faster
 * than LIST_POLL_MS: the backend cache TTL is 30s, so a shorter interval only
 * re-downloads an unchanged snapshot while keeping a slow rescan warm.
 */
export const SESSIONS_SUMMARY_PATH = "/sessions?view=summary";

/** Polling interval for the sessions list feed on every page that shows it. */
export const SESSIONS_LIST_POLL_MS = 60_000;
