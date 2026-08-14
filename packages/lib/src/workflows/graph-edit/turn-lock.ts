// packages/lib/src/workflows/graph-edit/turn-lock.ts

/**
 * Per-workflow "a Kopilot turn is open" marker — SERVER-ONLY (Redis).
 *
 * WHY THIS EXISTS: while a turn holds the draft, the canvas must not be
 * editable. Kopilot publishes one `workflow:draft-updated` per mutation, and
 * the builder's subscriber **drops** every event that arrives while the canvas
 * is dirty (`use-workflow-draft-realtime.ts`) with no queue and no catch-up
 * fetch. So a single user edit mid-turn silently strands the canvas on a
 * half-applied turn, which the next manual save then commits over the rest of
 * the agent's work. Locking the canvas for the duration of the turn is what
 * closes that. See `plans/kopilot/workflow/14-attio-workflow-builder-teardown.md`
 * §6.7.
 *
 * WHY THE SERVER OWNS IT, and not the chat client's `isStreaming` flag: that
 * flag goes FALSE on `approval-required` and true again on
 * `assistant-message-resumed`, because it describes the streaming UI, not the
 * turn. An approval pause is still inside the turn — the engine will resume
 * writing — so a client-derived lock would release exactly during the pause,
 * reopening the window at the moment the user is most likely to fiddle with the
 * canvas while waiting. The server boundary has no such gap: `withTurnEnd`
 * (`ai/agent-framework/engine.ts`) fires `onTurnEnd` exactly once on completion,
 * error, abort and client disconnect, and deliberately suppresses its finally
 * guard during an approval pause. Server-owned also means the lock survives the
 * Kopilot drawer being closed (which unmounts the SSE hook) and is visible to a
 * second tab on the same workflow.
 *
 * The stored value doubles as the queryable "is a turn open?" record, so a
 * client that missed the release — socket drop, reconnect after the turn
 * ended — can re-derive instead of trusting a local flag it can no longer
 * verify.
 *
 * FAIL-OPEN is deliberate throughout: an unreachable Redis leaves the canvas
 * EDITABLE. A stranded read-only canvas (recoverable only by reload) is a worse
 * failure than the race this prevents, and the hash-CAS inside `persistDraft`
 * is still the real correctness guard underneath.
 *
 * No permission checks live here (house rule) — `resolveWorkflowAuthoring` has
 * already run at every call site.
 */

import { createScopedLogger } from '@auxx/logger'
import { deleteRedisData, getRedisClient, getRedisData } from '@auxx/redis'

const logger = createScopedLogger('workflow-turn-lock')

/**
 * Backstop for a server that dies between acquire and release (deploy, crash,
 * OOM) — without it the key would outlive the turn and hold the canvas
 * read-only until someone cleared Redis by hand. Generous relative to a real
 * turn (Attio's observed builder turn was ~90s) because an approval pause keeps
 * a turn legitimately open while the user decides. The client watchdog in
 * `use-workflow-kopilot-turn.ts` is the faster of the two safety nets; this one
 * exists so the SERVER's record can never be permanently wrong.
 */
const TTL_SECONDS = 15 * 60

/** A turn currently holding a workflow's draft. */
export interface WorkflowTurnLock {
  turnId: string
  startedAt: number
}

const lockKey = (workflowAppId: string): string => `workflow:kopilot:turn:${workflowAppId}`

/**
 * Claim the workflow for `turnId`. Returns **true only on the transition** —
 * the first tool call of a turn — which is what makes this the edge trigger for
 * the `started` publish. Every later tool call in the same turn returns false.
 *
 * Atomic (`SET NX EX`), so two concurrent turns on one workflow cannot both see
 * an empty slot and both announce a start. Returns false when Redis is
 * unavailable: no lock is recorded, nothing is published, and the canvas stays
 * editable (see the fail-open note in the file docblock).
 *
 * A turn that re-enters after its own key expired re-acquires and re-publishes
 * `started`. That is correct rather than a bug: the client's watchdog has by
 * then released, so the re-announce is what puts the lock back.
 */
export async function acquireWorkflowTurnLock(
  workflowAppId: string,
  turnId: string
): Promise<boolean> {
  try {
    const client = await getRedisClient(false)
    if (!client) return false
    const lock: WorkflowTurnLock = { turnId, startedAt: Date.now() }
    const claimed = await client.set(
      lockKey(workflowAppId),
      JSON.stringify(lock),
      'EX',
      TTL_SECONDS,
      'NX'
    )
    return !!claimed
  } catch (error) {
    logger.warn('Failed to acquire workflow turn lock', {
      workflowAppId,
      turnId,
      error: (error as Error).message,
    })
    return false
  }
}

/**
 * Read the open turn for a workflow, if any. Backs the client's re-derive on
 * mount and on socket reconnect — the paths where a local flag cannot be
 * trusted because the release may have been published while disconnected.
 */
export async function readWorkflowTurnLock(
  workflowAppId: string
): Promise<WorkflowTurnLock | null> {
  try {
    const raw = (await getRedisData(lockKey(workflowAppId))) as WorkflowTurnLock | null
    return raw ?? null
  } catch (error) {
    logger.warn('Failed to read workflow turn lock', {
      workflowAppId,
      error: (error as Error).message,
    })
    return null
  }
}

/**
 * Release the workflow, **turn-checked** — same discipline as
 * `finalizeWorkflowTurn`. A stale turn's `onTurnEnd` must never release a
 * fresher turn's lock, which would unlock the canvas underneath a turn that is
 * still writing. Returns whether this turn actually held it, so the caller can
 * skip publishing an `ended` nobody is waiting for.
 */
export async function releaseWorkflowTurnLock(
  workflowAppId: string,
  turnId: string
): Promise<boolean> {
  try {
    const existing = (await getRedisData(lockKey(workflowAppId))) as WorkflowTurnLock | null
    if (existing?.turnId !== turnId) return false
    await deleteRedisData(lockKey(workflowAppId))
    return true
  } catch (error) {
    logger.warn('Failed to release workflow turn lock', {
      workflowAppId,
      turnId,
      error: (error as Error).message,
    })
    return false
  }
}

/**
 * Claim the workflow and, only on the acquiring transition, announce it. The
 * two halves belong together at every call site — a lock nobody was told about
 * locks nothing.
 *
 * The realtime barrel is lazy-imported for the same reason `persist.ts` does
 * it: a static import breaks `vi.mock` at collection as the module graph grows
 * (`project_realtime_barrel_import_cycle`).
 */
export async function beginWorkflowTurnLock(
  organizationId: string,
  workflowAppId: string,
  turnId: string
): Promise<void> {
  const claimed = await acquireWorkflowTurnLock(workflowAppId, turnId)
  if (!claimed) return
  await publishTurnPhase(organizationId, workflowAppId, turnId, 'started')
}

/**
 * Release the workflow and, only if this turn actually held it, announce it.
 * Called from the capability's `onTurnEnd`, which the engine fires on every
 * terminal path including abort and client disconnect.
 */
export async function endWorkflowTurnLock(
  organizationId: string,
  workflowAppId: string,
  turnId: string
): Promise<void> {
  const released = await releaseWorkflowTurnLock(workflowAppId, turnId)
  if (!released) return
  await publishTurnPhase(organizationId, workflowAppId, turnId, 'ended')
}

async function publishTurnPhase(
  organizationId: string,
  workflowAppId: string,
  turnId: string,
  phase: 'started' | 'ended'
): Promise<void> {
  try {
    const { getRealtimeService, publishWorkflowKopilotTurn } = await import('../../realtime')
    await publishWorkflowKopilotTurn(getRealtimeService(), organizationId, {
      workflowAppId,
      turnId,
      phase,
    })
  } catch {
    // Fire-and-forget. A lost `started` leaves the canvas editable; a lost
    // `ended` is caught by the client watchdog and the key's TTL.
  }
}
