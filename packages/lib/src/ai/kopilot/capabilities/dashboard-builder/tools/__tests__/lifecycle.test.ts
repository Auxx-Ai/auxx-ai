// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/__tests__/lifecycle.test.ts
//
// Turn-end lifecycle. Two rules:
//
//  1. A COMPLETED turn discards its snapshot via `finalizeDashboardTurn` - undo
//     of a successful turn is the canvas's job, so the server copy is dead
//     weight.
//  2. Every OTHER outcome - `exhausted` (token budget / iteration cap / failure
//     streak), `aborted` (reload, navigate-away) and `error` - keeps BOTH the
//     work and the snapshot. Revert is never automatic: the edits each
//     persisted through their own validation and hash-CAS, and the snapshot is
//     the fuel for the user-driven Undo card. Finalizing would delete that
//     recovery path, so it must not happen either. The outcome is additionally
//     STAMPED onto the surviving snapshot, because it is the only record of why
//     the card exists.
//
// The canvas turn lock is released on all four outcomes, before and outside the
// snapshot branch - on a dashboard that also resumes the 800ms auto-save.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnOutcome } from '../../../../../agent-framework/types'
import type { GetToolDeps, ToolDeps } from '../../../types'

const readDashboardTurnSnapshot = vi.fn()
const finalizeDashboardTurn = vi.fn()
const recordDashboardTurnEnding = vi.fn()
const revertDashboardTurn = vi.fn()
vi.mock('../../../../../../dashboards/draft-edit/turn-snapshot', () => ({
  readDashboardTurnSnapshot: (...a: unknown[]) => readDashboardTurnSnapshot(...a),
  finalizeDashboardTurn: (...a: unknown[]) => finalizeDashboardTurn(...a),
  recordDashboardTurnEnding: (...a: unknown[]) => recordDashboardTurnEnding(...a),
  revertDashboardTurn: (...a: unknown[]) => revertDashboardTurn(...a),
}))

const endDashboardTurnLock = vi.fn()
vi.mock('../../../../../../dashboards/draft-edit/turn-lock', () => ({
  endDashboardTurnLock: (...a: unknown[]) => endDashboardTurnLock(...a),
}))

import { createDashboardBuilderCapabilities } from '../../index'

const ORG = 'org-1'
const DASH = 'dash-1'
const TURN = 'turn-1'

/** The three outcomes that must keep the work AND the snapshot. */
const KEEP_OUTCOMES: TurnOutcome[] = ['exhausted', 'aborted', 'error']
const ALL_OUTCOMES: TurnOutcome[] = ['completed', ...KEEP_OUTCOMES]

let refs: Array<Record<string, unknown>> = [{ kind: 'dashboard', id: DASH }]

const getDeps: GetToolDeps = () =>
  ({
    db: { tag: 'db' },
    sessionContext: { page: 'dashboard.builder', references: refs },
    organizationId: ORG,
    userId: 'member-1',
    sessionId: 's-1',
    capabilities: undefined,
  }) as unknown as ToolDeps

function lifecycle() {
  const capability = createDashboardBuilderCapabilities(getDeps)
  if (!capability.lifecycle?.onTurnEnd) throw new Error('lifecycle missing')
  return capability.lifecycle.onTurnEnd.bind(capability.lifecycle)
}

beforeEach(() => {
  refs = [{ kind: 'dashboard', id: DASH }]
  readDashboardTurnSnapshot
    .mockReset()
    .mockResolvedValue({ turnId: TURN, doc: { tabs: [] }, capturedAt: 1 })
  finalizeDashboardTurn.mockReset().mockResolvedValue(undefined)
  recordDashboardTurnEnding.mockReset().mockResolvedValue(undefined)
  revertDashboardTurn.mockReset().mockResolvedValue(undefined)
  endDashboardTurnLock.mockReset().mockResolvedValue(undefined)
})

describe('dashboard.builder onTurnEnd', () => {
  it('completed means the snapshot is DISCARDED (finalize), never reverted', async () => {
    await lifecycle()('completed', { turnId: TURN })
    expect(readDashboardTurnSnapshot).toHaveBeenCalledWith(DASH, TURN)
    expect(finalizeDashboardTurn).toHaveBeenCalledTimes(1)
    expect(finalizeDashboardTurn).toHaveBeenCalledWith(DASH, TURN)
    expect(revertDashboardTurn).not.toHaveBeenCalled()
    // No ending to record: the snapshot is being deleted, and a completed turn
    // is the one ending the Undo card never has to explain.
    expect(recordDashboardTurnEnding).not.toHaveBeenCalled()
  })

  it('completed on a turn that never wrote means nothing to finalize', async () => {
    readDashboardTurnSnapshot.mockResolvedValue(null)
    await lifecycle()('completed', { turnId: TURN })
    expect(finalizeDashboardTurn).not.toHaveBeenCalled()
  })

  it.each(
    KEEP_OUTCOMES
  )('%s after a write is neither reverted NOR finalized - the snapshot survives', async (outcome) => {
    await lifecycle()(outcome, { turnId: TURN })
    expect(readDashboardTurnSnapshot).toHaveBeenCalledWith(DASH, TURN)
    expect(revertDashboardTurn).not.toHaveBeenCalled()
    // Finalizing would discard the snapshot, i.e. delete the only recovery
    // path for a turn that ran `delete_widgets` and then ran out of room.
    expect(finalizeDashboardTurn).not.toHaveBeenCalled()
    expect(recordDashboardTurnEnding).toHaveBeenCalledTimes(1)
    expect(recordDashboardTurnEnding).toHaveBeenCalledWith(DASH, TURN, outcome)
  })

  it.each(
    KEEP_OUTCOMES
  )('%s on a turn that never wrote (or was superseded) touches nothing', async (outcome) => {
    // The turn-checked read returning null IS the "did this turn write"
    // record: a stale prior-turn snapshot answers null for this turn id too.
    readDashboardTurnSnapshot.mockResolvedValue(null)
    await lifecycle()(outcome, { turnId: 'turn-2' })
    expect(readDashboardTurnSnapshot).toHaveBeenCalledWith(DASH, 'turn-2')
    expect(finalizeDashboardTurn).not.toHaveBeenCalled()
    expect(recordDashboardTurnEnding).not.toHaveBeenCalled()
  })

  it('a failing ending stamp is swallowed - the offer costs the adjective, not the Undo', async () => {
    recordDashboardTurnEnding.mockRejectedValue(new Error('redis down'))
    await expect(lifecycle()('exhausted', { turnId: TURN })).resolves.toBeUndefined()
    expect(finalizeDashboardTurn).not.toHaveBeenCalled()
  })

  it.each(ALL_OUTCOMES)('never reverts on %s - the restore is the user call', async (outcome) => {
    await lifecycle()(outcome, { turnId: TURN })
    expect(revertDashboardTurn).not.toHaveBeenCalled()
  })

  it('a failing finalize is swallowed and logged - turn end must not throw', async () => {
    finalizeDashboardTurn.mockRejectedValue(new Error('redis down'))
    await expect(lifecycle()('completed', { turnId: TURN })).resolves.toBeUndefined()
  })

  it('a failing snapshot read is swallowed - turn end must not throw', async () => {
    readDashboardTurnSnapshot.mockRejectedValue(new Error('redis down'))
    await expect(lifecycle()('exhausted', { turnId: TURN })).resolves.toBeUndefined()
  })

  it('no dashboard ref means no snapshot read at all', async () => {
    refs = []
    await lifecycle()('completed', { turnId: TURN })
    expect(readDashboardTurnSnapshot).not.toHaveBeenCalled()
  })
})

// The canvas lock is claimed on a turn's FIRST TOOL CALL of any kind, so its
// release cannot live behind the snapshot branch: a turn that only read holds
// the lock but has no snapshot. On a dashboard the lock also suspends the
// auto-save, so a stranded lock leaves the canvas read-only AND not saving.
describe('dashboard.builder onTurnEnd - canvas lock', () => {
  it.each(ALL_OUTCOMES)('releases the lock on %s', async (outcome) => {
    await lifecycle()(outcome, { turnId: TURN })
    expect(endDashboardTurnLock).toHaveBeenCalledTimes(1)
    expect(endDashboardTurnLock).toHaveBeenCalledWith(ORG, DASH, TURN)
  })

  it.each(ALL_OUTCOMES)('releases even when the turn never wrote on %s', async (outcome) => {
    readDashboardTurnSnapshot.mockResolvedValue(null)
    await lifecycle()(outcome, { turnId: TURN })
    expect(finalizeDashboardTurn).not.toHaveBeenCalled()
    expect(endDashboardTurnLock).toHaveBeenCalledWith(ORG, DASH, TURN)
  })

  it('a failing release cannot stop the snapshot bookkeeping', async () => {
    endDashboardTurnLock.mockRejectedValue(new Error('redis down'))
    await expect(lifecycle()('completed', { turnId: TURN })).resolves.toBeUndefined()
    expect(finalizeDashboardTurn).toHaveBeenCalledTimes(1)
  })

  it('no dashboard ref means nothing to release', async () => {
    refs = []
    await lifecycle()('completed', { turnId: TURN })
    expect(endDashboardTurnLock).not.toHaveBeenCalled()
  })
})
