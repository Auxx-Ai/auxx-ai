// packages/lib/src/dashboards/draft-edit/turn-lock.ts

/**
 * Per-dashboard "a Kopilot turn is open" marker. SERVER-ONLY (Redis).
 *
 * The Redis mechanics (atomic `SET NX EX` acquire, edge-triggered return,
 * turn-checked release, fail-open everywhere) live in
 * `turn-scoped/turn-lock.ts`, which states those three invariants and why each
 * is load-bearing. THIS module names the dashboard's key and TTL and owns the
 * realtime announcement. Everything below is the dashboard-specific WHY.
 *
 * WHY THIS EXISTS, and why it is NOT just a copy of the workflow lock: the
 * workflow canvas saves on an explicit action, so locking it only has to stop
 * a user editing under the agent. The dashboard page **auto-saves the WHOLE
 * document on an 800ms debounce** (`use-dashboard-autosave.ts`). That gives
 * this lock a second job the workflow one never had: it must also SUSPEND the
 * auto-save. A debounce that was already holding a pre-turn document and
 * flushes mid-turn does not merge with what the agent wrote, it replaces it,
 * end to end, with no conflict raised anywhere. The hash-CAS in `persist.ts`
 * turns that into a visible `ConflictError` rather than a silent loss; this
 * lock, and the `dashboard:kopilot-turn` event it publishes, is what stops it
 * happening at all.
 *
 * WHY THE SERVER OWNS IT, and not the chat client's `isStreaming` flag: that
 * flag goes false on `approval-required` and true again on resume, because it
 * describes the streaming UI and not the turn. A client-derived lock would
 * release exactly during an approval pause, which is the moment the user is
 * most likely to fiddle with the canvas while waiting.
 *
 * The lock is claimed on the first tool call of ANY kind, reads included, not
 * on the first mutation: a user who dirties the canvas after sending the
 * message but before the first write is invisible to the dirty gate, and
 * locking only on writes leaves exactly that window open.
 *
 * Fail-open matters here specifically because the hash-CAS is still the real
 * correctness guard underneath: an unreachable Redis costs the canvas lock,
 * not the draft.
 *
 * No permission checks live here (house rule).
 */

import { createTurnLock, type TurnLockRecord } from '../../turn-scoped/turn-lock'

/**
 * Backstop for a server that dies between acquire and release (deploy, crash,
 * OOM). Generous relative to a real turn because an approval pause keeps a turn
 * legitimately open while the user decides; the client-side watchdog is the
 * faster of the two safety nets, and this one exists so the SERVER's record can
 * never be permanently wrong.
 */
const TTL_SECONDS = 15 * 60

/** A turn currently holding a dashboard's draft. */
export type DashboardTurnLock = TurnLockRecord

const lock = createTurnLock({
  key: (dashboardId: string) => `dashboard:kopilot:turn:${dashboardId}`,
  ttlSeconds: TTL_SECONDS,
  logScope: 'dashboard-turn-lock',
})

/**
 * Claim the dashboard for `turnId`. Returns **true only on the transition**,
 * the first tool call of a turn, which is what makes this the edge trigger for
 * the `started` publish (invariant 1 of `turn-scoped/turn-lock.ts`).
 */
export async function acquireDashboardTurnLock(
  dashboardId: string,
  turnId: string
): Promise<boolean> {
  return lock.acquire(dashboardId, turnId)
}

/**
 * Read the open turn for a dashboard, if any. Backs the client's re-derive on
 * mount and on socket reconnect, the paths where a local flag cannot be trusted
 * because the release may have been published while disconnected.
 */
export async function readDashboardTurnLock(
  dashboardId: string
): Promise<DashboardTurnLock | null> {
  return lock.read(dashboardId)
}

/**
 * Release the dashboard, **turn-checked**. A stale turn's `onTurnEnd` must
 * never unlock the canvas (and resume auto-save) underneath a turn that is
 * still writing. Returns whether this turn actually held it, so the caller can
 * skip publishing an `ended` nobody is waiting for.
 */
export async function releaseDashboardTurnLock(
  dashboardId: string,
  turnId: string
): Promise<boolean> {
  return lock.release(dashboardId, turnId)
}

/**
 * Claim the dashboard and, only on the acquiring transition, announce it. The
 * two halves belong together at every call site: a lock nobody was told about
 * locks nothing, and here that also means an auto-save nobody suspended.
 *
 * The realtime barrel is lazy-imported for the same reason `persist.ts` does
 * it: a static import breaks `vi.mock` at collection as the module graph grows
 * (`project_realtime_barrel_import_cycle`).
 */
export async function beginDashboardTurnLock(
  organizationId: string,
  dashboardId: string,
  turnId: string
): Promise<void> {
  const claimed = await acquireDashboardTurnLock(dashboardId, turnId)
  if (!claimed) return
  await publishTurnPhase(organizationId, dashboardId, turnId, 'started')
}

/**
 * Release the dashboard and, only if this turn actually held it, announce it.
 * Called from the capability's `onTurnEnd`, which the engine fires on every
 * terminal path including abort and client disconnect. It must run for a
 * read-only turn too: the lock is claimed on the first tool call of any kind,
 * so gating the release on "did this turn write" would strand the canvas
 * read-only for the whole of every question-only turn.
 */
export async function endDashboardTurnLock(
  organizationId: string,
  dashboardId: string,
  turnId: string
): Promise<void> {
  const released = await releaseDashboardTurnLock(dashboardId, turnId)
  if (!released) return
  await publishTurnPhase(organizationId, dashboardId, turnId, 'ended')
}

async function publishTurnPhase(
  organizationId: string,
  dashboardId: string,
  turnId: string,
  phase: 'started' | 'ended'
): Promise<void> {
  try {
    const { getRealtimeService, publishDashboardKopilotTurn } = await import('../../realtime')
    await publishDashboardKopilotTurn(getRealtimeService(), organizationId, {
      dashboardId,
      turnId,
      phase,
    })
  } catch {
    // Fire-and-forget. A lost `started` leaves the canvas editable and
    // auto-saving (the CAS still guards the write); a lost `ended` is caught by
    // the client watchdog and the key's TTL.
  }
}
