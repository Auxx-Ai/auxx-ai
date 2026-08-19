// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/__tests__/lifecycle.test.ts
//
// Turn-end lifecycle. Two rules, and the second one INVERTED an earlier
// contract (plans/kopilot/workflow/20-partial-turn-survival.md phase A):
//
//  1. A COMPLETED turn discards its snapshot via `finalizeWorkflowTurn` —
//     undo of a successful turn is CLIENT-SIDE (the builder's realtime
//     subscriber records a canvas history entry), so the server copy is dead
//     weight.
//  2. Every OTHER outcome — `exhausted` (token budget / iteration cap /
//     failure streak), `aborted` (reload, navigate-away) and `error` — keeps
//     BOTH the work and the snapshot. Revert is never automatic: the edits
//     each persisted through their own validation and hash-CAS, and the
//     snapshot is the fuel for the user-driven Undo card ([C4]). Finalizing
//     would delete that recovery path, so it must not happen either. The
//     outcome is additionally STAMPED onto the surviving snapshot, because it
//     is the only record of why the card exists — the snapshot is a graph, not
//     a transcript, and by the time the card renders the turn is long gone.
//
// The canvas edit lock is released on all four outcomes, before and outside
// the snapshot branch.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../../../../errors'
import type { TurnOutcome } from '../../../../../agent-framework/types'
import type { GetToolDeps, ToolDeps } from '../../../types'

const readWorkflowTurnSnapshot = vi.fn()
const revertWorkflowTurn = vi.fn()
const finalizeWorkflowTurn = vi.fn()
const recordWorkflowTurnEnding = vi.fn()
vi.mock('../../../../../../workflows/graph-edit/turn-snapshot', () => ({
  readWorkflowTurnSnapshot: (...a: unknown[]) => readWorkflowTurnSnapshot(...a),
  revertWorkflowTurn: (...a: unknown[]) => revertWorkflowTurn(...a),
  finalizeWorkflowTurn: (...a: unknown[]) => finalizeWorkflowTurn(...a),
  recordWorkflowTurnEnding: (...a: unknown[]) => recordWorkflowTurnEnding(...a),
}))

const endWorkflowTurnLock = vi.fn()
vi.mock('../../../../../../workflows/graph-edit/turn-lock', () => ({
  endWorkflowTurnLock: (...a: unknown[]) => endWorkflowTurnLock(...a),
}))

import { createWorkflowBuilderCapabilities } from '../../index'

const ORG = 'org-1'
const WF = 'wfapp-1'
const TURN = 'turn-1'

/** The three outcomes that must keep the work AND the snapshot. */
const KEEP_OUTCOMES: TurnOutcome[] = ['exhausted', 'aborted', 'error']
const ALL_OUTCOMES: TurnOutcome[] = ['completed', ...KEEP_OUTCOMES]

let refs: Array<Record<string, unknown>> = [{ kind: 'workflow', id: WF }]
const db = { tag: 'db' }

const getDeps: GetToolDeps = () =>
  ({
    db,
    sessionContext: { page: 'workflow.builder', references: refs },
    organizationId: ORG,
    userId: 'member-1',
    sessionId: 's-1',
    capabilities: undefined,
  }) as unknown as ToolDeps

function lifecycle() {
  const capability = createWorkflowBuilderCapabilities(getDeps)
  if (!capability.lifecycle?.onTurnEnd) throw new Error('lifecycle missing')
  return capability.lifecycle.onTurnEnd.bind(capability.lifecycle)
}

beforeEach(() => {
  refs = [{ kind: 'workflow', id: WF }]
  readWorkflowTurnSnapshot
    .mockReset()
    .mockResolvedValue({ turnId: TURN, graph: { nodes: [], edges: [] }, capturedAt: 1 })
  revertWorkflowTurn.mockReset().mockResolvedValue(ok({ graphHash: 'h' }))
  finalizeWorkflowTurn.mockReset().mockResolvedValue(undefined)
  recordWorkflowTurnEnding.mockReset().mockResolvedValue(undefined)
  endWorkflowTurnLock.mockReset().mockResolvedValue(undefined)
})

describe('workflow.builder onTurnEnd', () => {
  it('completed ⇒ the snapshot is DISCARDED (finalize), never reverted', async () => {
    await lifecycle()('completed', { turnId: TURN })
    expect(readWorkflowTurnSnapshot).toHaveBeenCalledWith(WF, TURN)
    expect(finalizeWorkflowTurn).toHaveBeenCalledTimes(1)
    expect(finalizeWorkflowTurn).toHaveBeenCalledWith(WF, TURN)
    expect(revertWorkflowTurn).not.toHaveBeenCalled()
    // No ending to record: the snapshot is being deleted, and a completed turn
    // is the one ending the Undo banner never has to explain.
    expect(recordWorkflowTurnEnding).not.toHaveBeenCalled()
  })

  it('completed on a turn that never wrote ⇒ nothing to finalize', async () => {
    readWorkflowTurnSnapshot.mockResolvedValue(null)
    await lifecycle()('completed', { turnId: TURN })
    expect(finalizeWorkflowTurn).not.toHaveBeenCalled()
  })

  // The reported bug: twelve good edits thrown away because the engine tallied
  // the turn's tokens AFTER it had already finished and replied.
  it.each(
    KEEP_OUTCOMES
  )('%s after a write ⇒ neither reverted NOR finalized — the snapshot survives', async (outcome) => {
    await lifecycle()(outcome, { turnId: TURN })
    expect(readWorkflowTurnSnapshot).toHaveBeenCalledWith(WF, TURN)
    expect(revertWorkflowTurn).not.toHaveBeenCalled()
    // Finalizing would discard the snapshot — i.e. delete the only recovery
    // path for a turn that ran `delete_nodes` and then ran out of room.
    expect(finalizeWorkflowTurn).not.toHaveBeenCalled()
    // ...and the ending IS stamped on it. Additive: this rewrites one field of
    // the slot the two assertions above just pinned as surviving, which is what
    // lets the Undo offer say why it is there instead of only that it is.
    expect(recordWorkflowTurnEnding).toHaveBeenCalledTimes(1)
    expect(recordWorkflowTurnEnding).toHaveBeenCalledWith(WF, TURN, outcome)
  })

  it.each(
    KEEP_OUTCOMES
  )('%s on a turn that never wrote (or was superseded) ⇒ nothing touched', async (outcome) => {
    // The turn-checked read returning null IS the "did this turn write"
    // record — a stale prior-turn snapshot answers null for this turn id too.
    readWorkflowTurnSnapshot.mockResolvedValue(null)
    await lifecycle()(outcome, { turnId: 'turn-2' })
    expect(readWorkflowTurnSnapshot).toHaveBeenCalledWith(WF, 'turn-2')
    expect(revertWorkflowTurn).not.toHaveBeenCalled()
    expect(finalizeWorkflowTurn).not.toHaveBeenCalled()
    // Nothing to label either — there is no offer for the ending to describe.
    expect(recordWorkflowTurnEnding).not.toHaveBeenCalled()
  })

  it('a failing ending stamp is swallowed — the offer costs the adjective, not the Undo', async () => {
    recordWorkflowTurnEnding.mockRejectedValue(new Error('redis down'))
    await expect(lifecycle()('exhausted', { turnId: TURN })).resolves.toBeUndefined()
    // Still no finalize: a stamp that failed must not take the snapshot with it.
    expect(finalizeWorkflowTurn).not.toHaveBeenCalled()
    expect(revertWorkflowTurn).not.toHaveBeenCalled()
  })

  it.each(ALL_OUTCOMES)('never reverts on %s — the restore is the user’s call', async (o) => {
    // Guard against a future "helpful" auto-rollback creeping back in: a
    // ConflictError from a stale revert is not something this hook can ever
    // see, because it never calls revert at all.
    revertWorkflowTurn.mockResolvedValue(err(new ConflictError('canvas moved on')))
    await lifecycle()(o, { turnId: TURN })
    expect(revertWorkflowTurn).not.toHaveBeenCalled()
  })

  it('a failing finalize is swallowed and logged — turn end must not throw', async () => {
    finalizeWorkflowTurn.mockRejectedValue(new Error('redis down'))
    await expect(lifecycle()('completed', { turnId: TURN })).resolves.toBeUndefined()
  })

  it('a failing snapshot read is swallowed — turn end must not throw', async () => {
    readWorkflowTurnSnapshot.mockRejectedValue(new Error('redis down'))
    await expect(lifecycle()('exhausted', { turnId: TURN })).resolves.toBeUndefined()
  })

  it('no workflow ref ⇒ no snapshot read at all', async () => {
    refs = []
    await lifecycle()('completed', { turnId: TURN })
    expect(readWorkflowTurnSnapshot).not.toHaveBeenCalled()
  })
})

// The canvas edit lock is claimed on a turn's FIRST TOOL CALL of any kind, so
// its release cannot live behind the snapshot branch above — a turn that only
// read holds the lock but has no snapshot. See plan 14 §6.7.
describe('workflow.builder onTurnEnd — canvas edit lock', () => {
  it.each(ALL_OUTCOMES)('releases the lock on %s', async (outcome) => {
    await lifecycle()(outcome, { turnId: TURN })
    expect(endWorkflowTurnLock).toHaveBeenCalledTimes(1)
    expect(endWorkflowTurnLock).toHaveBeenCalledWith(ORG, WF, TURN)
  })

  // The regression this guards: releasing inside the `if (!snapshot) return`
  // path would strand the canvas read-only for the whole of every
  // question-only turn ("what does this workflow do?"), which writes nothing
  // and therefore never captures a snapshot.
  it.each(ALL_OUTCOMES)('releases even when the turn never wrote on %s', async (outcome) => {
    readWorkflowTurnSnapshot.mockResolvedValue(null)
    await lifecycle()(outcome, { turnId: TURN })
    expect(finalizeWorkflowTurn).not.toHaveBeenCalled()
    expect(endWorkflowTurnLock).toHaveBeenCalledWith(ORG, WF, TURN)
  })

  it('a failing release cannot stop the snapshot bookkeeping', async () => {
    endWorkflowTurnLock.mockRejectedValue(new Error('redis down'))
    await expect(lifecycle()('completed', { turnId: TURN })).resolves.toBeUndefined()
    expect(finalizeWorkflowTurn).toHaveBeenCalledTimes(1)
  })

  it('no workflow ref ⇒ nothing to release', async () => {
    refs = []
    await lifecycle()('completed', { turnId: TURN })
    expect(endWorkflowTurnLock).not.toHaveBeenCalled()
  })
})
