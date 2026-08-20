// packages/lib/src/workflows/graph-edit/turn-snapshot.ts

/**
 * Per-turn pre-edit snapshot of the draft graph — SERVER-ONLY (Redis + the
 * persist seam). Mirrors `kb/kopilot-snapshot.ts` (`03-graph-edit-service.md`
 * §7): the FIRST mutation of a turn stores the pre-edit graph under
 * `(workflowAppId, turnId)` with a 24h TTL. The snapshot exists ONLY to make a
 * turn's edits reversible AS A GROUP: {@link revertWorkflowTurn} restores the
 * exact prior graph and workflow details through `persistDraft`, and on turn
 * SUCCESS it is discarded via {@link finalizeWorkflowTurn}. Undo of a
 * completed turn is client-side — the builder's `workflow:draft-updated`
 * subscriber records each Kopilot edit as a normal canvas history entry.
 * The snapshot deliberately OUTLIVES a turn that stopped early (nothing
 * consumes it at turn end), so the recovery path is still there when the
 * caller offers it; residual cleanup is the next turn's capture overwriting
 * the slot, the TTL, or a manual draft save clearing it via
 * {@link clearWorkflowTurnSnapshot}.
 *
 * One slot per workflow app — each new turn overwrites the prior turn's
 * snapshot, and the slot naturally expires via Redis TTL. `readWorkflowTurnSnapshot`
 * returning null for a turn id IS the "did this turn write anything" record:
 * a turn whose mutations all rejected never captured, so there is nothing to
 * revert. The turn id must be CHECKED, never assumed — a fresher turn's
 * snapshot in the slot means the asking turn was superseded, and restoring it
 * would roll the draft back past edits the asking turn never made.
 *
 * The turn id is only half the check. Because the restore is offered rather
 * than performed, it can be taken long after the turn ended, so the snapshot
 * also carries the hash of the graph the turn LEFT BEHIND
 * (`postTurnGraphSemanticHash`, stamped per write by
 * {@link recordWorkflowTurnPostHash}). If the draft no longer hashes to that,
 * the canvas moved on and the revert refuses — see {@link revertWorkflowTurn}.
 *
 * The snapshot also carries HOW its turn ended (`endedAs`, stamped once at turn
 * end by {@link recordWorkflowTurnEnding}), because the offer has to be able to
 * say why it exists and by then the turn is over — nothing else on this side
 * remembers. It is additive bookkeeping only: absence must never suppress the
 * offer.
 *
 * No permission checks live here (house rule): the capability layer asserts
 * `assertEditInstance('workflow', workflowAppId)` +
 * `assertWorkflowAppNotSystemOwned` before calling in.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { deleteRedisData, getRedisData, setRedisData } from '@auxx/redis'
import { err, type Result } from 'neverthrow'
import { type AuxxError, ConflictError, NotFoundError } from '../../errors'
import { hashGraphSemantics } from '../graph-hash'
import {
  cleanGraphForSave,
  type PersistDraftOutcome,
  persistDraft,
  publishDraftUpdatedSignal,
} from './persist'
import { type GraphEditScope, loadDraftContext } from './read'
import type { DraftGraph } from './types'

const logger = createScopedLogger('workflow-turn-snapshot')

const TTL_SECONDS = 24 * 60 * 60

/**
 * How the turn that owns a snapshot ended — the three non-`completed` members
 * of the agent framework's `TurnOutcome`, mirrored here rather than imported.
 *
 * WHY MIRRORED: `workflows/graph-edit` is a headless draft-editing module and
 * must not take a dependency on `ai/agent-framework` to name three strings.
 * The two vocabularies cannot drift silently anyway — the capability passes
 * `outcome` straight into {@link recordWorkflowTurnEnding} on the branch where
 * TypeScript has already narrowed it to exactly these three, so a framework
 * rename fails the build at the call site.
 *
 * `completed` is deliberately unrepresentable: a completed turn calls
 * {@link finalizeWorkflowTurn} and its snapshot is gone, so no snapshot the
 * user can ever be offered was left by a completed turn.
 */
export type WorkflowTurnEnding = 'exhausted' | 'aborted' | 'error'

/**
 * Pre-turn snapshot captured before a turn's first draft write. Backs the
 * revert-on-failure path (failed-turn atomicity) — nothing else.
 */
export interface WorkflowPreTurnSnapshot {
  turnId: string
  /** WorkflowApp metadata exactly as stored before the turn's first write. */
  name: string
  description: string | null
  /** The draft graph exactly as stored BEFORE the turn's first write. */
  graph: DraftGraph
  /** The draft row's trigger type column at capture time (persist fallback). */
  triggerType: string | null
  capturedAt: number
  /**
   * Hash of the stored graph as of the turn's LAST successful write — the
   * "did the canvas move on since?" token {@link revertWorkflowTurn} compares
   * against. Stamped by {@link recordWorkflowTurnPostHash} after every persist
   * in the turn (last write wins), never at capture: the capture runs BEFORE
   * the turn's first write and is idempotent per turn, so it cannot know where
   * the turn ends up. Undefined only for a snapshot written by code older than
   * this field, or when a stamp's Redis write failed.
   */
  postTurnGraphSemanticHash?: string
  /**
   * How the turn ended, stamped once at turn end by
   * {@link recordWorkflowTurnEnding}. The ONLY record of why the offer exists:
   * the snapshot is a graph, not a tool-call log or a transcript, and by the
   * time the Undo is offered the turn is over and there is no agent left to
   * ask.
   *
   * Undefined is a first-class value, not a bug — a snapshot captured by code
   * older than this field, a turn that died before its `onTurnEnd` hook ran at
   * all, or a stamp whose Redis write failed. Every reader MUST fail OPEN on
   * undefined and still make the offer: losing the adjective is a far smaller
   * loss than losing the Undo.
   */
  endedAs?: WorkflowTurnEnding
}

const snapshotKey = (workflowAppId: string): string => `workflow:graph:${workflowAppId}:preturn`

/**
 * Capture the pre-edit graph for a turn — called from the mutation pipeline
 * BEFORE its write. Idempotent per turn: if the slot already holds THIS
 * turn's snapshot, it is left untouched (a second mutation in the same turn
 * must not bump the snapshot — that would defeat whole-turn revert/Undo). A
 * snapshot from a PRIOR turn is overwritten: the new turn supersedes it.
 *
 * Returns whether a snapshot was written (false = same-turn no-op).
 */
export async function captureWorkflowTurnSnapshot(
  workflowAppId: string,
  turnId: string,
  data: {
    graph: DraftGraph
    triggerType?: string | null
    name: string
    description: string | null
  }
): Promise<boolean> {
  const existing = (await getRedisData(
    snapshotKey(workflowAppId)
  )) as WorkflowPreTurnSnapshot | null
  if (existing?.turnId === turnId) return false

  const snapshot: WorkflowPreTurnSnapshot = {
    turnId,
    name: data.name,
    description: data.description,
    graph: data.graph,
    triggerType: data.triggerType ?? null,
    capturedAt: Date.now(),
  }
  await setRedisData(snapshotKey(workflowAppId), snapshot, TTL_SECONDS)
  return true
}

/**
 * Stamp the graph hash the turn's write just produced onto the turn's own
 * snapshot — called from the mutation pipeline AFTER every successful
 * `persistDraft`, with the hash `persistDraft` returned (i.e. the hash of what
 * the draft row now actually holds, which is exactly what the next
 * `loadDraftContext` will compute). Last write wins, so once the turn stops
 * writing the stamp IS the post-turn hash.
 *
 * WHY here and not at turn end: a turn that dies — token budget, disconnect,
 * a throw — may never reach a turn-end call at all, and after plan 20 phase A
 * the capability deliberately stops calling `finalizeWorkflowTurn` on
 * non-completed outcomes. Those are precisely the turns whose snapshot has to
 * survive and stay checkable, so the stamp must not depend on any turn-end
 * hook running. Stamping per write cannot go stale: the last write to land is
 * by definition the graph the turn left behind.
 *
 * Turn-checked like {@link finalizeWorkflowTurn} — a stale turn must never
 * re-stamp a fresher turn's snapshot. Best-effort: a failed stamp leaves
 * `postTurnGraphSemanticHash` at its previous (older) value, which makes a later
 * revert refuse rather than clobber — the safe direction.
 */
export async function recordWorkflowTurnPostHash(
  workflowAppId: string,
  turnId: string,
  graphSemanticHash: string | null
): Promise<void> {
  if (!graphSemanticHash) return
  try {
    const existing = (await getRedisData(
      snapshotKey(workflowAppId)
    )) as WorkflowPreTurnSnapshot | null
    if (existing?.turnId !== turnId) return
    if (existing.postTurnGraphSemanticHash === graphSemanticHash) return
    // Re-`setex` refreshes the 24h TTL. Bounded by the turn's own duration
    // (only this turn's writes reach this line), so the window a snapshot
    // outlives its turn by never grows meaningfully.
    await setRedisData(
      snapshotKey(workflowAppId),
      { ...existing, postTurnGraphSemanticHash: graphSemanticHash },
      TTL_SECONDS
    )
  } catch (error) {
    logger.warn('Failed to record post-turn semantic graph hash', {
      workflowAppId,
      turnId,
      error: (error as Error).message,
    })
  }
}

/**
 * Stamp HOW the turn ended onto the turn's own snapshot — called from the
 * capability's `onTurnEnd` on the outcomes that keep the snapshot alive
 * (`exhausted` / `aborted` / `error`). ADDITIVE, never a finalize: the whole
 * point of plan 20 [C4] is that a turn which stopped early keeps both its work
 * and its snapshot, and this only writes the label the Undo offer needs to say
 * WHY it is there.
 *
 * WHY at turn end and not per write (the opposite of
 * {@link recordWorkflowTurnPostHash}): a write cannot know how the turn will
 * end, and the ending is exactly what a write has no view of. The cost is that
 * a turn dying before its hook runs leaves this undefined — which is why every
 * reader fails open (see {@link WorkflowPreTurnSnapshot.endedAs}).
 *
 * Turn-checked like {@link finalizeWorkflowTurn}: a stale turn must never
 * relabel a fresher turn's snapshot with its own ending. Best-effort — a
 * failure leaves the field undefined, i.e. today's generic wording, and the
 * offer itself is untouched. It must never throw: it runs on a turn-end path
 * whose one job is to leave the recovery route intact.
 */
export async function recordWorkflowTurnEnding(
  workflowAppId: string,
  turnId: string,
  endedAs: WorkflowTurnEnding
): Promise<void> {
  try {
    const existing = (await getRedisData(
      snapshotKey(workflowAppId)
    )) as WorkflowPreTurnSnapshot | null
    if (existing?.turnId !== turnId) return
    if (existing.endedAs === endedAs) return
    // Re-`setex` refreshes the 24h TTL from turn end rather than from the
    // turn's first write — which is the window the user actually gets to
    // decide in, so this is the correct clock, not an accidental extension.
    await setRedisData(snapshotKey(workflowAppId), { ...existing, endedAs }, TTL_SECONDS)
  } catch (error) {
    logger.warn('Failed to record workflow turn ending', {
      workflowAppId,
      turnId,
      endedAs,
      error: (error as Error).message,
    })
  }
}

/**
 * Read the current snapshot for a workflow app. Pass `expectedTurnId` to
 * verify ownership — the call returns null when the stored snapshot belongs
 * to a different (newer) turn, which is how a stale caller detects it was
 * superseded. Null also means "this turn never wrote anything" — the two are
 * deliberately indistinguishable; neither has anything to revert.
 */
export async function readWorkflowTurnSnapshot(
  workflowAppId: string,
  expectedTurnId?: string
): Promise<WorkflowPreTurnSnapshot | null> {
  const raw = (await getRedisData(snapshotKey(workflowAppId))) as WorkflowPreTurnSnapshot | null
  if (!raw) return null
  if (expectedTurnId && raw.turnId !== expectedTurnId) return null
  return raw
}

/**
 * Discard the turn's snapshot, turn-checked. Callers: the capability's
 * `onTurnEnd` on turn SUCCESS (the turn committed — nothing left to revert)
 * and the revert path (after a successful restore there is nothing left to
 * undo). Deletes only when the slot still belongs to `turnId`: a stale call
 * from a prior turn must never clear a fresher turn's snapshot. Best-effort —
 * a leftover snapshot expires via TTL, and the turn-id check in the revert
 * path refuses it anyway.
 */
export async function finalizeWorkflowTurn(workflowAppId: string, turnId: string): Promise<void> {
  try {
    const existing = (await getRedisData(
      snapshotKey(workflowAppId)
    )) as WorkflowPreTurnSnapshot | null
    if (existing?.turnId !== turnId) return
    await deleteRedisData(snapshotKey(workflowAppId))
  } catch (error) {
    logger.warn('Failed to finalize workflow turn snapshot', {
      workflowAppId,
      turnId,
      error: (error as Error).message,
    })
  }
}

/**
 * Delete the snapshot unconditionally (no turn check). The workflow twin of
 * KB's `clearKopilotSnapshot`: called from non-Kopilot write paths — a manual
 * canvas save through `WorkflowService.update` — so a late failed-turn revert
 * can never roll the draft back over edits the user made by hand mid-turn.
 * Best-effort: a clear that fails only leaves a snapshot the TTL expires.
 */
export async function clearWorkflowTurnSnapshot(workflowAppId: string): Promise<void> {
  try {
    await deleteRedisData(snapshotKey(workflowAppId))
  } catch (error) {
    logger.warn('Failed to clear workflow turn snapshot', {
      workflowAppId,
      error: (error as Error).message,
    })
  }
}

/**
 * Restore the exact pre-turn graph. Not automatic — the caller offers it (plan
 * 20 phase D) and the user's click is what runs it, which means it can fire
 * minutes after the turn ended, on a canvas that has moved on.
 *
 * TWO distinct refusals, and callers are expected to tell them apart because
 * the user-facing statement differs:
 *
 * - `NotFoundError` (404) — there is no snapshot under `turnId`: the turn never
 *   wrote to the draft, a later turn superseded the slot, the 24h TTL expired,
 *   or a manual canvas save cleared it via {@link clearWorkflowTurnSnapshot}.
 *   Nothing to undo, and nothing was touched.
 * - `ConflictError` (409, `details.reason === 'canvas-changed-since-turn'`) —
 *   the snapshot is there, but the draft no longer hashes to what the turn left
 *   behind ({@link WorkflowPreTurnSnapshot.postTurnGraphSemanticHash}). Someone edited
 *   the canvas after the turn, so restoring the pre-turn graph would destroy
 *   work the turn never made. Refused; the snapshot is LEFT IN PLACE.
 *
 * That comparison is the whole point of the post-turn hash: `persistDraft`'s
 * own CAS token is read fresh microseconds before the write, so it guards a
 * race INSIDE this function and nothing across time. It still runs (a save
 * racing the revert surfaces as its own `ConflictError`) — it is simply not
 * the check that detects a diverged canvas.
 *
 * The restore goes through `persistDraft`, so trigger-column re-derivation and
 * the mail-trigger guard also run. On success the snapshot is discarded and the
 * `workflow:draft-updated` signal fires (reason `system`) so open canvases
 * refetch.
 */
export async function revertWorkflowTurn(
  db: Database,
  scope: GraphEditScope,
  turnId: string
): Promise<Result<PersistDraftOutcome, AuxxError>> {
  const snapshot = await readWorkflowTurnSnapshot(scope.workflowAppId, turnId)
  if (!snapshot) {
    return err(
      new NotFoundError(
        `No snapshot for turn "${turnId}" — either the turn never wrote to the draft, ` +
          'or a later turn superseded it. Nothing was reverted.'
      )
    )
  }

  const loaded = await loadDraftContext(db, scope)
  if (loaded.isErr()) return err(loaded.error)

  // Both sides are `hashGraphSemantics` over the CLEANED graph — the stamp
  // hashes what `persistDraft` wrote, this hashes what `loadDraftContext` read
  // back — so it is an exact comparison, not an approximation.
  //
  // It must be the SEMANTIC hash, not `graphHash`. Opening the builder fires an
  // autosave carrying a fresh viewport and selection with byte-identical node
  // content; against the full-document hash that reads as "the canvas moved on"
  // and every Undo refuses seconds after the offer appears (plan 20 F5).
  //
  // Fails OPEN when either side is unknown — a snapshot captured before this
  // field existed, or a draft row with no graph at all. Unknown must not turn
  // a legitimate Undo into a hard refusal; the pre-existing guards (turn id,
  // TTL, the manual-save clear, the CAS below) still apply.
  // CANONICALIZED BEFORE HASHING, on purpose (plan 23 §3.2). The stamp was
  // taken over the CLEANED graph `persistDraft` wrote, while `loadDraftContext`
  // now returns a HYDRATED one — the semantic projection does not ignore
  // everything hydration adds (`extent`, `data.id`, and the read-time defaults
  // layer are all content-shaped), so comparing the two directly would report
  // "the canvas moved on" for every Undo. Running the write seam's own cleanup
  // first puts both sides in the same shape.
  const liveSemanticHash = loaded.value.graph
    ? hashGraphSemantics(cleanGraphForSave(loaded.value.graph))
    : undefined
  if (
    snapshot.postTurnGraphSemanticHash !== undefined &&
    liveSemanticHash !== undefined &&
    liveSemanticHash !== snapshot.postTurnGraphSemanticHash
  ) {
    return err(
      new ConflictError(
        'The workflow canvas has changed since that turn finished, so those edits can no ' +
          'longer be undone as a group — undoing now would also discard the newer changes. ' +
          'Nothing was reverted. Use the canvas history to step back instead.',
        { reason: 'canvas-changed-since-turn' }
      )
    )
  }

  const persisted = await persistDraft(db, scope, {
    graph: snapshot.graph,
    fallbackTriggerType: snapshot.triggerType,
    name: snapshot.name,
    description: snapshot.description,
    ...(loaded.value.graphHash !== undefined ? { expectedGraphHash: loaded.value.graphHash } : {}),
  })
  if (persisted.isErr()) return persisted

  await finalizeWorkflowTurn(scope.workflowAppId, turnId)
  await publishDraftUpdatedSignal(scope.organizationId, {
    workflowAppId: scope.workflowAppId,
    reason: 'system',
  })
  return persisted
}
