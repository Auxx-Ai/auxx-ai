// packages/lib/src/workflows/graph-edit/turn-lock.ts

/**
 * Per-workflow "a Kopilot turn is open" marker — SERVER-ONLY (Redis).
 *
 * The Redis mechanics (atomic `SET NX EX` acquire, turn-checked release,
 * fail-open everywhere) live in `turn-scoped/turn-lock.ts`, which states those
 * three invariants and why each is load-bearing. THIS module names the
 * workflow's key and TTL, and owns the realtime announcement. Everything below
 * is the workflow-specific WHY.
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
 * Fail-open (invariant 3 of the generic module) matters here specifically
 * because the hash-CAS inside `persistDraft` is still the real correctness guard
 * underneath: an unreachable Redis costs the canvas lock, not the draft.
 *
 * No permission checks live here (house rule) — `resolveWorkflowAuthoring` has
 * already run at every call site.
 */

import { createTurnLock, type TurnLockRecord } from '../../turn-scoped/turn-lock'

/**
 * Backstop for a server that dies between acquire and release (deploy, crash,
 * OOM). Generous relative to a real turn (Attio's observed builder turn was
 * ~90s) because an approval pause keeps a turn legitimately open while the user
 * decides. The client watchdog in `use-workflow-kopilot-turn.ts` is the faster
 * of the two safety nets; see `turn-scoped/turn-lock.ts` for why the server
 * needs one at all.
 */
const TTL_SECONDS = 15 * 60

/** A turn currently holding a workflow's draft. */
export type WorkflowTurnLock = TurnLockRecord

const lock = createTurnLock({
  key: (workflowAppId: string) => `workflow:kopilot:turn:${workflowAppId}`,
  ttlSeconds: TTL_SECONDS,
  logScope: 'workflow-turn-lock',
})

/**
 * Claim the workflow for `turnId`. Returns **true only on the transition** —
 * the first tool call of a turn — which is what makes this the edge trigger for
 * the `started` publish (invariant 1 of `turn-scoped/turn-lock.ts`).
 *
 * A turn that re-enters after its own key expired re-acquires and re-publishes
 * `started`. That is correct rather than a bug: the client's watchdog has by
 * then released, so the re-announce is what puts the lock back.
 */
export async function acquireWorkflowTurnLock(
  workflowAppId: string,
  turnId: string
): Promise<boolean> {
  return lock.acquire(workflowAppId, turnId)
}

/**
 * Read the open turn for a workflow, if any. Backs the client's re-derive on
 * mount and on socket reconnect — the paths where a local flag cannot be
 * trusted because the release may have been published while disconnected.
 */
export async function readWorkflowTurnLock(
  workflowAppId: string
): Promise<WorkflowTurnLock | null> {
  return lock.read(workflowAppId)
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
  return lock.release(workflowAppId, turnId)
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
