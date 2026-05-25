// packages/lib/src/presence/presence-types.ts

/**
 * Three-state observational presence. Auto-derived from the realtime
 * connection + an idle heartbeat — never set manually.
 *
 *  - `online`  — subscribed to the org presence room and not idle.
 *  - `away`    — subscribed but the client flipped `meta.idle = true`
 *    (tab hidden or no interaction for the idle threshold).
 *  - `offline` — not currently subscribed (tab closed / network gone).
 *
 * Intent (chat duty, future user status) lives in separate features.
 */
export type PresenceState = 'online' | 'away' | 'offline'

/** Idle threshold the heartbeat uses to flip online → away. */
export const PRESENCE_IDLE_MS = 60_000

/**
 * Resolve a presence state from raw signals. `subscribed` is true when the
 * user is currently in the org presence room; `idle` reflects their latest
 * `meta.idle` flag from the heartbeat. Missing `idle` is treated as not-idle.
 */
export function resolvePresence(opts: { subscribed: boolean; idle?: boolean }): PresenceState {
  if (!opts.subscribed) return 'offline'
  return opts.idle ? 'away' : 'online'
}
