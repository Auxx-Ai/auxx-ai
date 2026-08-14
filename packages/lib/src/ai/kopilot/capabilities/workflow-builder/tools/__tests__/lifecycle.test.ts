// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/__tests__/lifecycle.test.ts
//
// Turn-end lifecycle (04 §4, revised 2026-08-14): undo of a successful turn is
// CLIENT-SIDE (the builder's realtime subscriber records a canvas history
// entry), so a COMPLETED turn DISCARDS its snapshot via `finalizeWorkflowTurn`
// — the snapshot survives only as failed-turn atomicity. A failed turn
// reverts, guarded by `expectedTurnId` so a later failed turn can never roll
// back a workflow it didn't touch.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '../../../../../../errors'
import type { GetToolDeps, ToolDeps } from '../../../types'

const readWorkflowTurnSnapshot = vi.fn()
const revertWorkflowTurn = vi.fn()
const finalizeWorkflowTurn = vi.fn()
vi.mock('../../../../../../workflows/graph-edit/turn-snapshot', () => ({
  readWorkflowTurnSnapshot: (...a: unknown[]) => readWorkflowTurnSnapshot(...a),
  revertWorkflowTurn: (...a: unknown[]) => revertWorkflowTurn(...a),
  finalizeWorkflowTurn: (...a: unknown[]) => finalizeWorkflowTurn(...a),
}))

import { createWorkflowBuilderCapabilities } from '../../index'

const ORG = 'org-1'
const WF = 'wfapp-1'
const TURN = 'turn-1'

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
})

describe('workflow.builder onTurnEnd', () => {
  it('completed ⇒ the snapshot is DISCARDED (finalize), never reverted', async () => {
    await lifecycle()('completed', { turnId: TURN })
    expect(readWorkflowTurnSnapshot).toHaveBeenCalledWith(WF, TURN)
    expect(finalizeWorkflowTurn).toHaveBeenCalledTimes(1)
    expect(finalizeWorkflowTurn).toHaveBeenCalledWith(WF, TURN)
    expect(revertWorkflowTurn).not.toHaveBeenCalled()
  })

  it('completed on a turn that never wrote ⇒ nothing to finalize', async () => {
    readWorkflowTurnSnapshot.mockResolvedValue(null)
    await lifecycle()('completed', { turnId: TURN })
    expect(finalizeWorkflowTurn).not.toHaveBeenCalled()
  })

  it('error ⇒ reverts, threading the turn id as expectedTurnId', async () => {
    await lifecycle()('error', { turnId: TURN })
    expect(revertWorkflowTurn).toHaveBeenCalledTimes(1)
    expect(revertWorkflowTurn).toHaveBeenCalledWith(
      db,
      { workflowAppId: WF, organizationId: ORG },
      TURN
    )
  })

  it('error on a turn that never wrote (or was superseded) ⇒ nothing reverted', async () => {
    // The turn-checked read returning null IS the "did this turn write" record —
    // a stale prior-turn snapshot answers null for this turn id too.
    readWorkflowTurnSnapshot.mockResolvedValue(null)
    await lifecycle()('error', { turnId: 'turn-2' })
    expect(readWorkflowTurnSnapshot).toHaveBeenCalledWith(WF, 'turn-2')
    expect(revertWorkflowTurn).not.toHaveBeenCalled()
  })

  it('a failed revert is swallowed and logged — turn end must not throw', async () => {
    revertWorkflowTurn.mockResolvedValue(err(new NotFoundError('superseded')))
    await expect(lifecycle()('error', { turnId: TURN })).resolves.toBeUndefined()
  })

  it('no workflow ref ⇒ no snapshot read at all', async () => {
    refs = []
    await lifecycle()('completed', { turnId: TURN })
    expect(readWorkflowTurnSnapshot).not.toHaveBeenCalled()
  })
})
