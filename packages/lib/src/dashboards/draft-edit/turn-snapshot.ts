// packages/lib/src/dashboards/draft-edit/turn-snapshot.ts

/**
 * Per-turn pre-edit snapshot of a dashboard's draft layout. SERVER-ONLY
 * (Redis + the persist seam). `plans/dashboard/v3/03-concurrency-and-turn-lifecycle.md`
 * §3.
 *
 * The FIRST mutation of a turn stores the pre-edit doc under
 * `(dashboardId, turnId)` with a 24h TTL. It exists ONLY to make a turn's edits
 * reversible AS A GROUP: {@link revertDashboardTurn} restores the exact prior
 * doc through the persist seam.
 *
 * The Redis mechanics (capture idempotent per turn, every read and write
 * turn-checked, best-effort where a turn must not break) live in
 * `turn-scoped/turn-slot.ts`, which states those four invariants and why each
 * is load-bearing. THIS module names the dashboard's key, TTL and payload, and
 * owns the revert.
 *
 * REVERT IS NEVER AUTOMATIC, and not finalising is as load-bearing as not
 * reverting. On a `completed` turn the caller finalises, which discards the
 * snapshot: Undo of a completed turn belongs to the canvas. On every other
 * outcome the work AND the snapshot are kept and `endedAs` is stamped. A turn
 * that added five widgets and then tripped the token budget leaves five
 * complete, individually validated, individually persisted widgets that the
 * user watched land; a draft has no atomicity requirement to protect, and
 * "half-finished" is what the canvas looks like every time a human stops
 * mid-thought. Finalising there would discard the only recovery path left.
 *
 * Leaving a snapshot behind is safe rather than a leak and must not be tidied
 * up: one slot per dashboard, the next turn's capture overwrites it,
 * {@link readDashboardTurnSnapshot} is turn-checked so a superseded caller sees
 * null, a manual save clears it, and Redis expires it in 24h.
 *
 * A DASHBOARD SIMPLIFICATION worth naming, because the workflow twin needed two
 * hashes and this does not: a layout doc has no viewport and no selection, so
 * there is no "opening the builder auto-saves a cosmetic change" problem and no
 * separate semantic hash. {@link hashLayoutDoc} is BOTH the CAS token and the
 * staleness token.
 *
 * No permission checks live here (house rule).
 */

import type { Database } from '@auxx/database'
import { err, type Result } from 'neverthrow'
import { type AuxxError, ConflictError, NotFoundError } from '../../errors'
import { createTurnSlot } from '../../turn-scoped/turn-slot'
import type { DashboardLayoutDoc } from '../client'
import { type PersistLayoutOutcome, persistLayout, publishDraftUpdatedSignal } from './persist'
import { loadDraftContext } from './read'
import type { DashboardEditScope } from './types'

const TTL_SECONDS = 24 * 60 * 60

/**
 * How the turn that owns a snapshot ended: the three non-`completed` members of
 * the agent framework's `TurnOutcome`, mirrored here rather than imported.
 *
 * WHY MIRRORED: `dashboards/` is a headless draft-editing module and must not
 * take a dependency on `ai/agent-framework` to name three strings, the same
 * rule `workflows/graph-edit/turn-snapshot.ts` documents. The two vocabularies
 * cannot drift silently anyway, because the capability passes `outcome`
 * straight into {@link recordDashboardTurnEnding} on the branch where
 * TypeScript has already narrowed it to exactly these three, so a framework
 * rename fails the build at the call site.
 *
 * `completed` is deliberately unrepresentable: a completed turn finalises and
 * its snapshot is gone, so no snapshot a user can ever be offered was left by
 * one.
 */
export type DashboardTurnEnding = 'exhausted' | 'aborted' | 'error'

/** Pre-turn snapshot captured before a turn's first draft write. */
export interface DashboardPreTurnSnapshot {
  turnId: string
  /** The draft layout exactly as stored BEFORE the turn's first write. */
  doc: DashboardLayoutDoc
  capturedAt: number
  /**
   * Hash of the stored draft as of the turn's LAST successful write: the "did
   * the canvas move on since?" token {@link revertDashboardTurn} compares
   * against. Stamped after every persist in the turn (last write wins), never
   * at capture, because the capture runs BEFORE the turn's first write and is
   * idempotent per turn, so it cannot know where the turn ends up. Stamping per
   * write also means a turn that dies without reaching any turn-end hook still
   * has a usable token. Undefined only for a snapshot written by code older
   * than this field, or when a stamp's Redis write failed.
   */
  postTurnLayoutHash?: string
  /**
   * How the turn ended, stamped once at turn end. The ONLY record of why an
   * Undo offer exists: the snapshot is a document, not a transcript, and by the
   * time the offer is shown the turn is over and there is no agent left to ask.
   *
   * Undefined is a first-class value, not a bug (a turn that died before its
   * hook ran, or a failed stamp). Every reader MUST fail OPEN on undefined and
   * still make the offer: losing the adjective is a far smaller loss than
   * losing the Undo.
   */
  endedAs?: DashboardTurnEnding
}

const slot = createTurnSlot<DashboardPreTurnSnapshot>({
  key: (dashboardId: string) => `dashboard:layout:${dashboardId}:preturn`,
  ttlSeconds: TTL_SECONDS,
  logScope: 'dashboard-turn-snapshot',
})

/**
 * Capture the pre-edit layout for a turn. Called from the mutation pipeline
 * BEFORE its write. Idempotent per turn (invariant 1 of
 * `turn-scoped/turn-slot.ts`): a second mutation in the same turn must not bump
 * the snapshot, or whole-turn Undo silently degrades to undo-the-last-edit.
 *
 * Returns whether a snapshot was written (false = same-turn no-op).
 */
export async function captureDashboardTurnSnapshot(
  dashboardId: string,
  turnId: string,
  doc: DashboardLayoutDoc
): Promise<boolean> {
  return slot.capture(dashboardId, { turnId, doc, capturedAt: Date.now() })
}

/**
 * Stamp the layout hash the turn's write just produced onto the turn's own
 * snapshot. Called AFTER every successful {@link persistLayout}, with the hash
 * that persist returned, which is exactly what the next `loadDraftContext` will
 * compute. Last write wins, so once the turn stops writing the stamp IS the
 * post-turn hash.
 *
 * Turn-checked, unchanged-value-skipping and TTL-refreshing, all from
 * `slot.patch`. Best-effort: a failed stamp leaves the field at its previous
 * (older) value, which makes a later revert REFUSE rather than clobber, the
 * safe direction.
 */
export async function recordDashboardTurnPostHash(
  dashboardId: string,
  turnId: string,
  layoutHash: string | null | undefined
): Promise<void> {
  if (!layoutHash) return
  await slot.patch(dashboardId, turnId, { postTurnLayoutHash: layoutHash })
}

/**
 * Stamp HOW the turn ended onto the turn's own snapshot. Called from the
 * capability's `onTurnEnd` on the outcomes that KEEP the snapshot alive.
 * ADDITIVE, never a finalize: the whole point is that a turn which stopped
 * early keeps both its work and its snapshot, and this only writes the label
 * the Undo offer needs to say why it is there.
 *
 * Turn-checked and best-effort. It must never throw: it runs on a turn-end path
 * whose one job is to leave the recovery route intact.
 */
export async function recordDashboardTurnEnding(
  dashboardId: string,
  turnId: string,
  endedAs: DashboardTurnEnding
): Promise<void> {
  await slot.patch(dashboardId, turnId, { endedAs })
}

/**
 * Read the current snapshot for a dashboard. Pass `expectedTurnId` to verify
 * ownership: the call returns null when the stored snapshot belongs to a
 * different (newer) turn, which is how a stale caller detects it was
 * superseded. Null also means "this turn never wrote anything"; the two are
 * deliberately indistinguishable, because neither has anything to recover.
 */
export async function readDashboardTurnSnapshot(
  dashboardId: string,
  expectedTurnId?: string
): Promise<DashboardPreTurnSnapshot | null> {
  return slot.read(dashboardId, expectedTurnId)
}

/**
 * Discard the turn's snapshot, turn-checked. Callers: the capability's
 * `onTurnEnd` on turn SUCCESS (the turn committed, nothing left to recover) and
 * the revert path after a successful restore. Deletes only when the slot still
 * belongs to `turnId`, so a stale call from a prior turn can never clear a
 * fresher turn's snapshot. Best-effort.
 */
export async function finalizeDashboardTurn(dashboardId: string, turnId: string): Promise<void> {
  await slot.finalize(dashboardId, turnId)
}

/**
 * Delete the snapshot unconditionally, **no turn check**. For the non-agent
 * write paths (a manual canvas save, a publish, a version restore) so a late
 * revert can never roll the draft back over edits the user made by hand
 * mid-turn. Best-effort.
 */
export async function clearDashboardTurnSnapshot(dashboardId: string): Promise<void> {
  await slot.clear(dashboardId)
}

/**
 * Restore the exact pre-turn layout. Not automatic: the caller offers it and
 * the user's click is what runs it, which means it can fire minutes after the
 * turn ended, on a canvas that has moved on.
 *
 * TWO distinct refusals, and callers are expected to tell them apart because
 * the user-facing sentence differs:
 *
 * - {@link NotFoundError} - there is no snapshot under `turnId`: the turn never
 *   wrote, a later turn superseded the slot, the 24h TTL expired, or a manual
 *   save cleared it. Nothing to undo, and nothing was touched.
 * - {@link ConflictError} (`details.reason === 'canvas-changed-since-turn'`) -
 *   the snapshot is there, but the live draft no longer hashes to
 *   {@link DashboardPreTurnSnapshot.postTurnLayoutHash}. Someone edited the
 *   dashboard after the turn, so restoring the pre-turn doc would destroy work
 *   the turn never made. Refused, and the snapshot is LEFT IN PLACE.
 *
 * That comparison is the whole point of the post-turn hash: the persist seam's
 * own CAS token is read microseconds before the write, so it guards a race
 * INSIDE this function and nothing across time. It still runs (a save racing
 * the revert surfaces as its own `ConflictError`); it is simply not the check
 * that detects a diverged canvas.
 *
 * Fails OPEN when either hash is undefined. Unknown must not turn a legitimate
 * Undo into a hard refusal; the turn-id check, the TTL, the manual-save clear
 * and the CAS below all still apply.
 *
 * On success the snapshot is discarded and `dashboard:draft-updated` fires with
 * reason `system`, so open dashboards refetch.
 */
export async function revertDashboardTurn(
  db: Database,
  scope: DashboardEditScope,
  turnId: string
): Promise<Result<PersistLayoutOutcome, AuxxError>> {
  const snapshot = await readDashboardTurnSnapshot(scope.dashboardId, turnId)
  if (!snapshot) {
    return err(
      new NotFoundError(
        `No snapshot for turn "${turnId}": either the turn never wrote to the draft, or a ` +
          'later turn superseded it. Nothing was reverted.'
      )
    )
  }

  const loaded = await loadDraftContext(db, scope)
  if (loaded.isErr()) return err(loaded.error)

  // Both sides are `hashLayoutDoc` over the PARSED doc (the stamp hashed what
  // the persist wrote, this is what `loadDraftContext` read back), so it is an
  // exact comparison rather than an approximation. A layout doc carries no
  // viewport or selection, so there is nothing cosmetic to exclude.
  const liveHash = loaded.value.layoutHash
  if (
    snapshot.postTurnLayoutHash !== undefined &&
    liveHash !== undefined &&
    liveHash !== snapshot.postTurnLayoutHash
  ) {
    return err(
      new ConflictError(
        'The dashboard has changed since that turn finished, so those edits can no longer be ' +
          'undone as a group: undoing now would also discard the newer changes. Nothing was ' +
          'reverted.',
        { reason: 'canvas-changed-since-turn' }
      )
    )
  }

  const persisted = await persistLayout(db, scope, {
    doc: snapshot.doc,
    ...(liveHash !== undefined ? { expectedLayoutHash: liveHash } : {}),
  })
  if (persisted.isErr()) return persisted

  await finalizeDashboardTurn(scope.dashboardId, turnId)
  await publishDraftUpdatedSignal(scope.organizationId, {
    dashboardId: scope.dashboardId,
    reason: 'system',
  })
  return persisted
}
