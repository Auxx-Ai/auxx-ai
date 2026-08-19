// packages/lib/src/connections/connect-events.ts
//
// The wire contract for "a connect finished", shared by the server that publishes it
// (`post-connect-hooks.ts`) and the browser that listens for it. Deliberately its own module with
// no runtime imports, so a client component can name the event without pulling the connections
// barrel — and with it the database, the credential store, and every provider transport.

import type { PendingSelectionKind } from './pending-selection'

/**
 * Realtime event published on the connecting user's private room (`rooms.user`) the instant the
 * post-connect hook resolves, whatever it resolved to.
 *
 * ## Why a push exists at all
 *
 * The OAuth callback runs the hook BEFORE it can render anything back to the browser, so the tab
 * that started the connect learns the outcome only from the popup's termination page — a channel
 * that is lost whenever `Cross-Origin-Opener-Policy` severs the opener, the popup was blocked into
 * a full-page redirect, or the popup flow already settled on its cancel heuristic (which fires on
 * nothing more than the opener regaining focus, and tears the listeners down while a multi-second
 * hook is still running). Every one of those leaves a finished connect invisible until something
 * unrelated happens to re-query.
 *
 * A push has none of those failure modes: it is addressed to the **user**, not to a window, and it
 * arrives whether or not the popup lived. The connect surface can therefore go straight to its
 * next step on click and wait for this — instead of racing the popup for the right to open.
 *
 * ## What it is NOT
 *
 * A **signal, not a source of truth**. Realtime is a no-op when Pusher is unconfigured, so
 * anything that exists only as this event does not exist. The server queries stay the authority
 * (`channel.pendingConnectSelection` for a parked connect, `channel.list` for a provisioned one);
 * the only correct reactions to this event are "read one of those" and "stop waiting".
 */
export interface ConnectionSettledEvent {
  credentialId: string
  providerKey: string
  /** False when the hook threw — the credential is committed but the connect failed. */
  ok: boolean
  /**
   * The hook deliberately provisioned nothing and parked a choice, naming its kind. Read
   * `pendingConnectSelection` on receipt; the options are deliberately NOT in this payload — the
   * event is addressed to a room, and the query is where the permission check lives.
   */
  awaiting: PendingSelectionKind | null
  /** Present only when `ok` is false. Already user-facing — hooks throw prose. */
  error?: string
}

/** The event name, on `rooms.user(connectingUserId)`. */
export const CONNECTION_SETTLED_EVENT = 'connection:settled'
