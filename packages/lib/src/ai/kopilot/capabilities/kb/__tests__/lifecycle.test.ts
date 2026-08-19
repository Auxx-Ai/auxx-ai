// packages/lib/src/ai/kopilot/capabilities/kb/__tests__/lifecycle.test.ts
//
// KB turn-end lifecycle ([C5] of plans/kopilot/workflow/20-partial-turn-survival.md).
// The KB capability had the same defect as the workflow builder: any outcome
// other than `completed` restored the pre-turn article, so a turn that rewrote
// six sections and then tripped the token budget lost all six.
//
// The rule now: **revert is never automatic.** Every outcome finalizes.
// KB's finalize is NOT the workflow builder's — `finalizeKopilotKbTurn` means
// "release the editor lock, KEEP the snapshot so the turn stays reviewable",
// whereas `finalizeWorkflowTurn` DISCARDS its snapshot (the canvas owns undo of
// a completed turn). So finalizing on every outcome is exactly right here: the
// article keeps the turn's blocks, the editor unlocks, and the rollback is
// offered by the turn-review banner (`kb.revertKopilotTurn`) — the user's
// click, never the server's inference.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnOutcome } from '../../../../agent-framework/types'
import type { GetToolDeps, ToolDeps } from '../../types'

const readKopilotSnapshot = vi.fn()
const captureKopilotSnapshot = vi.fn()
const clearKopilotSnapshot = vi.fn()
vi.mock('../../../../../kb/kopilot-snapshot', () => ({
  readKopilotSnapshot: (...a: unknown[]) => readKopilotSnapshot(...a),
  captureKopilotSnapshot: (...a: unknown[]) => captureKopilotSnapshot(...a),
  clearKopilotSnapshot: (...a: unknown[]) => clearKopilotSnapshot(...a),
}))

const finalizeKopilotKbTurn = vi.fn()
const revertKopilotKbTurn = vi.fn()
// PARTIAL mock: the four block-CRUD tool modules this capability constructs all
// import `runBlockCrudOp` & friends from the same module, so a wholesale
// replacement would fail at COLLECTION on the exports the factory omitted.
vi.mock('../tools/write-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tools/write-helpers')>()),
  finalizeKopilotKbTurn: (...a: unknown[]) => finalizeKopilotKbTurn(...a),
  revertKopilotKbTurn: (...a: unknown[]) => revertKopilotKbTurn(...a),
}))

import { createKbCapabilities } from '../index'

const ARTICLE = 'art-1'
const TURN = 'turn-1'

/** The three outcomes that must keep the work AND the snapshot. */
const KEEP_OUTCOMES: TurnOutcome[] = ['exhausted', 'aborted', 'error']
const ALL_OUTCOMES: TurnOutcome[] = ['completed', ...KEEP_OUTCOMES]

let refs: Array<Record<string, unknown>> = [{ kind: 'article', id: ARTICLE }]

const getDeps: GetToolDeps = () =>
  ({
    db: { tag: 'db' },
    sessionContext: { page: 'kb', references: refs },
    organizationId: 'org-1',
    userId: 'member-1',
    sessionId: 's-1',
    capabilities: undefined,
  }) as unknown as ToolDeps

function lifecycle() {
  const capability = createKbCapabilities(getDeps)
  if (!capability.lifecycle?.onTurnEnd) throw new Error('lifecycle missing')
  return capability.lifecycle.onTurnEnd.bind(capability.lifecycle)
}

beforeEach(() => {
  refs = [{ kind: 'article', id: ARTICLE }]
  readKopilotSnapshot
    .mockReset()
    .mockResolvedValue({ turnId: TURN, contentJson: [], contentHash: 'h', capturedAt: 1 })
  finalizeKopilotKbTurn.mockReset().mockResolvedValue(undefined)
  revertKopilotKbTurn.mockReset().mockResolvedValue({ ok: true, reverted: true })
})

describe('kb onTurnEnd', () => {
  it('completed ⇒ finalizes (unlock, snapshot kept for review)', async () => {
    await lifecycle()('completed', { turnId: TURN })
    expect(readKopilotSnapshot).toHaveBeenCalledWith(ARTICLE, TURN)
    expect(finalizeKopilotKbTurn).toHaveBeenCalledTimes(1)
    expect(finalizeKopilotKbTurn).toHaveBeenCalledWith({ articleId: ARTICLE })
    expect(revertKopilotKbTurn).not.toHaveBeenCalled()
  })

  // The inverted contract: these three used to restore the pre-turn article.
  it.each(KEEP_OUTCOMES)('%s after a write ⇒ the edits are KEPT, never reverted', async (o) => {
    await lifecycle()(o, { turnId: TURN })
    expect(revertKopilotKbTurn).not.toHaveBeenCalled()
    // Finalize is still called — it is what releases the editor lock, and it
    // keeps the snapshot, so the Undo banner still has something to offer.
    expect(finalizeKopilotKbTurn).toHaveBeenCalledWith({ articleId: ARTICLE })
  })

  it.each(ALL_OUTCOMES)('releases the editor lock on %s', async (outcome) => {
    // `finalizeKopilotKbTurn` IS the unlock (it publishes `locked: false`
    // with `reviewable: true`), so a turn that wrote must always reach it —
    // otherwise the article stays read-only until the 24h TTL.
    await lifecycle()(outcome, { turnId: TURN })
    expect(finalizeKopilotKbTurn).toHaveBeenCalledTimes(1)
  })

  it.each(ALL_OUTCOMES)('a turn that never wrote is untouched on %s', async (outcome) => {
    // The turn-checked read returning null IS the "did THIS turn write" record;
    // a prior turn's still-pending review snapshot answers null here too, so it
    // can never be finalized (or reverted) by a later turn. No snapshot also
    // means no `locked: true` was ever published — nothing to release.
    readKopilotSnapshot.mockResolvedValue(null)
    await lifecycle()(outcome, { turnId: 'turn-2' })
    expect(readKopilotSnapshot).toHaveBeenCalledWith(ARTICLE, 'turn-2')
    expect(finalizeKopilotKbTurn).not.toHaveBeenCalled()
    expect(revertKopilotKbTurn).not.toHaveBeenCalled()
  })

  it('no article ref ⇒ no snapshot read at all', async () => {
    refs = []
    await lifecycle()('error', { turnId: TURN })
    expect(readKopilotSnapshot).not.toHaveBeenCalled()
    expect(finalizeKopilotKbTurn).not.toHaveBeenCalled()
  })

  it('a failing finalize is swallowed and logged — turn end must not throw', async () => {
    finalizeKopilotKbTurn.mockRejectedValue(new Error('redis down'))
    await expect(lifecycle()('exhausted', { turnId: TURN })).resolves.toBeUndefined()
  })

  it('a failing snapshot read is swallowed — turn end must not throw', async () => {
    readKopilotSnapshot.mockRejectedValue(new Error('redis down'))
    await expect(lifecycle()('completed', { turnId: TURN })).resolves.toBeUndefined()
  })
})
