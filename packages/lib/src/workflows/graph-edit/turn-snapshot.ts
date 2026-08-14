// packages/lib/src/workflows/graph-edit/turn-snapshot.ts

/**
 * Per-turn pre-edit snapshot of the draft graph — SERVER-ONLY (Redis + the
 * persist seam). Mirrors `kb/kopilot-snapshot.ts` (`03-graph-edit-service.md`
 * §7): the FIRST mutation of a turn stores the pre-edit graph under
 * `(workflowAppId, turnId)` with a 24h TTL. On turn FAILURE the lifecycle
 * reverts (restores the exact prior graph through `persistDraft`). On turn
 * SUCCESS the snapshot is deliberately KEPT — it backs the per-turn Undo card
 * (KB parity: `finalizeKopilotKbTurn` keeps its snapshot too, so
 * `revertWorkflowTurn` stays reachable after a completed turn). Cleanup is the
 * next turn's capture overwriting the slot, the TTL, or a manual draft save
 * clearing it via {@link clearWorkflowTurnSnapshot}.
 *
 * One slot per workflow app — each new turn overwrites the prior turn's
 * snapshot, and the slot naturally expires via Redis TTL. `readWorkflowTurnSnapshot`
 * returning null for a turn id IS the "did this turn write anything" record:
 * a turn whose mutations all rejected never captured, so there is nothing to
 * revert. The turn id must be CHECKED, never assumed — a fresher turn's
 * snapshot in the slot means the asking turn was superseded, and restoring it
 * would roll the draft back past edits the asking turn never made.
 *
 * No permission checks live here (house rule): the capability layer asserts
 * `assertEditInstance('workflow', workflowAppId)` +
 * `assertWorkflowAppNotSystemOwned` before calling in.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { deleteRedisData, getRedisData, setRedisData } from '@auxx/redis'
import { err, type Result } from 'neverthrow'
import { type AuxxError, NotFoundError } from '../../errors'
import { type PersistDraftOutcome, persistDraft, publishDraftUpdatedSignal } from './persist'
import { type GraphEditScope, loadDraftContext } from './read'
import type { DraftGraph } from './types'

const logger = createScopedLogger('workflow-turn-snapshot')

const TTL_SECONDS = 24 * 60 * 60

/**
 * Pre-turn snapshot captured before a turn's first draft write. Backs the
 * revert-on-failure path and a per-turn Undo affordance.
 */
export interface WorkflowPreTurnSnapshot {
  turnId: string
  /** The draft graph exactly as stored BEFORE the turn's first write. */
  graph: DraftGraph
  /** The draft row's trigger type column at capture time (persist fallback). */
  triggerType: string | null
  capturedAt: number
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
  data: { graph: DraftGraph; triggerType?: string | null }
): Promise<boolean> {
  const existing = (await getRedisData(
    snapshotKey(workflowAppId)
  )) as WorkflowPreTurnSnapshot | null
  if (existing?.turnId === turnId) return false

  const snapshot: WorkflowPreTurnSnapshot = {
    turnId,
    graph: data.graph,
    triggerType: data.triggerType ?? null,
    capturedAt: Date.now(),
  }
  await setRedisData(snapshotKey(workflowAppId), snapshot, TTL_SECONDS)
  return true
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
 * Discard the turn's snapshot, turn-checked. NOT called on turn success — a
 * completed turn keeps its snapshot so the per-turn Undo card can still call
 * {@link revertWorkflowTurn} (KB parity; see the module docblock). Callers:
 * the revert path (after a successful restore there is nothing left to undo)
 * and any future cleanup that must not clobber a fresher turn's slot.
 * Deletes only when the slot still belongs to `turnId`: a stale call from
 * a prior turn must never clear a fresher turn's snapshot. Best-effort — a
 * leftover snapshot expires via TTL, and the turn-id check in the revert path
 * refuses it anyway.
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
 * canvas save through `WorkflowService.update` — so a stale Undo can never
 * roll the draft back over edits the user made by hand after the turn.
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
 * Restore the exact pre-turn graph — the FAILURE half of the turn lifecycle,
 * and the Undo card's server piece after a COMPLETED turn (the snapshot
 * survives success precisely so this stays callable).
 * The stored snapshot must belong to `turnId`: a snapshot from a prior turn
 * is REJECTED, never restored (restoring it would roll back edits this turn
 * never made), and no snapshot means the turn never wrote — also nothing to
 * revert.
 *
 * The restore goes through `persistDraft`, so trigger-column re-derivation,
 * the mail-trigger guard and the hash-CAS all run: a write that landed
 * between the failure and this revert surfaces as a `ConflictError` instead
 * of being clobbered. On success the snapshot is discarded and the
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

  const persisted = await persistDraft(db, scope, {
    graph: snapshot.graph,
    fallbackTriggerType: snapshot.triggerType,
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
