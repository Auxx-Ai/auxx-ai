// packages/lib/src/workflows/graph-edit/__tests__/turn-lifecycle.test.ts

/**
 * Turn snapshot / revert + realtime signal + CAS surfacing
 * (`03-graph-edit-service.md` §7, `07-remaining-mechanics.md` §6): first
 * mutation of a turn captures the pre-edit graph, a second mutation of the
 * SAME turn does not overwrite it, a failed turn's revert restores the exact
 * prior graph, a PRIOR turn's stale snapshot is rejected (NOTE: a COMPLETED
 * turn's snapshot is discarded by the capability lifecycle via
 * `finalizeWorkflowTurn` — undo of a successful turn is client-side canvas
 * history, so the snapshot exists only for failed-turn atomicity), the
 * `workflow:draft-updated` signal fires after a successful persist (and never
 * on a rejected mutation), and a hash-CAS conflict surfaces as a typed,
 * actionable `ConflictError` — never a generic 500, never a silent overwrite.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../../errors'
import { hashWorkflowGraph } from '../../graph-hash'

// Partial mock — the cache barrel is imported by half of lib; replacing it
// wholesale dies at collection. Only the read the graph-edit path makes is stubbed.
const getCachedResources = vi.fn()
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
}))

// The persist seam writes through WorkflowService.update (lazy-imported in
// persist.ts) — replaced so no engine/queue module graph loads.
const serviceUpdate = vi.fn()
vi.mock('../../workflow-service', () => ({
  WorkflowService: class {
    update(...args: unknown[]) {
      return serviceUpdate(...args)
    }
  },
}))

const mailGuard = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../mail-trigger-guard', () => ({
  assertMailTriggerNotPersonal: (...args: unknown[]) => mailGuard(...args),
}))

// In-memory Redis fake — the snapshot slot. Partial mock: the barrel is
// imported by other lib modules (credential-lock), so only the data helpers
// the snapshot uses are stubbed.
const redisStore = new Map<string, unknown>()
vi.mock('@auxx/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/redis')>()),
  getRedisData: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  setRedisData: vi.fn(async (key: string, data: unknown) => {
    redisStore.set(key, data)
    return 'OK'
  }),
  deleteRedisData: vi.fn(async (key: string) => {
    const had = redisStore.delete(key)
    return had ? 1 : 0
  }),
}))

// The realtime barrel is lazy-imported inside publishDraftUpdatedSignal —
// replaced wholesale so none of its module graph loads at collection.
const publishWorkflowDraftUpdated = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ tag: 'realtime-service' }),
  publishWorkflowDraftUpdated: (...args: unknown[]) => publishWorkflowDraftUpdated(...args),
}))

const { addNode } = await import('../ops')
const { finalizeWorkflowTurn, readWorkflowTurnSnapshot, revertWorkflowTurn } = await import(
  '../turn-snapshot'
)

import type { DraftGraph, GraphNode } from '../types'

const ORG = 'org_1'
const APP = 'wfapp_1'
const TURN_A = 'turn_aaaa'
const TURN_B = 'turn_bbbb'
const TRIGGER_ID = 'scheduled-aaaaaaaaaaaaaaaaaaaaa'

function triggerNode(): GraphNode {
  return {
    id: TRIGGER_ID,
    type: 'standard',
    position: { x: 100, y: 200 },
    width: 244,
    height: 100,
    data: {
      id: TRIGGER_ID,
      type: 'scheduled',
      title: 'Every Morning',
      config: {
        triggerInterval: 'days',
        timeBetweenTriggers: { days: 1, isConstant: true },
        timezone: 'UTC',
      },
      isEnabled: true,
    },
  }
}

function baseGraph(): DraftGraph {
  return { nodes: [triggerNode()], edges: [] }
}

/** In-memory WorkflowApp row + db stub for `loadDraftContext`. */
function makeDb(graph: DraftGraph, triggerType: string | null = 'scheduled') {
  const app = {
    id: APP,
    name: 'My Flow',
    organizationId: ORG,
    draftWorkflow: {
      id: 'wf_draft',
      name: 'My Flow (Draft)',
      graph,
      triggerType,
      entityDefinitionId: null,
      organizationId: ORG,
      version: 3,
    },
  }
  const db = { query: { WorkflowApp: { findFirst: vi.fn(async () => app) } } }
  return db as unknown as import('@auxx/database').Database
}

const scope = (turnId?: string) => ({
  workflowAppId: APP,
  organizationId: ORG,
  ...(turnId ? { turnId } : {}),
})

const addWait = (db: import('@auxx/database').Database, turnId?: string, title = 'Wait A Bit') =>
  addNode(db, { ...scope(turnId), type: 'wait', title, after: 'Every Morning' })

beforeEach(() => {
  redisStore.clear()
  getCachedResources.mockReset()
  getCachedResources.mockResolvedValue([])
  mailGuard.mockReset()
  mailGuard.mockResolvedValue(undefined)
  publishWorkflowDraftUpdated.mockReset()
  serviceUpdate.mockReset()
  serviceUpdate.mockImplementation(async (_org: string, input: Record<string, unknown>) => ({
    graphHash: 'hash-after',
    triggerType: input.triggerType ?? null,
    entityDefinitionId: input.entityDefinitionId ?? null,
  }))
})

describe('turn snapshot capture', () => {
  it('captures the PRE-edit graph on the first mutation of a turn', async () => {
    const graph = baseGraph()
    const result = await addWait(makeDb(graph), TURN_A)
    expect(result.isOk()).toBe(true)

    const snapshot = await readWorkflowTurnSnapshot(APP, TURN_A)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.turnId).toBe(TURN_A)
    expect(snapshot?.triggerType).toBe('scheduled')
    // The snapshot is the graph BEFORE the mutation — one node, no wait.
    expect(snapshot?.graph.nodes.map((n) => n.id)).toEqual([TRIGGER_ID])
    expect(snapshot?.graph.edges).toEqual([])
  })

  it('does NOT overwrite the snapshot on a second mutation of the same turn', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    const first = await readWorkflowTurnSnapshot(APP, TURN_A)

    // Second mutation of the SAME turn, on the now-grown draft.
    const grown = (serviceUpdate.mock.calls.at(-1)?.[1] as { graph: DraftGraph }).graph
    const result = await addNode(makeDb(grown), {
      ...scope(TURN_A),
      type: 'wait',
      title: 'Wait Again',
      after: 'Wait A Bit',
    })
    expect(result.isOk()).toBe(true)

    const second = await readWorkflowTurnSnapshot(APP, TURN_A)
    expect(second).toEqual(first) // still the turn's ORIGINAL pre-edit graph
    expect(second?.graph.nodes).toHaveLength(1)
  })

  it('takes no snapshot without a turnId, and none when the mutation is rejected', async () => {
    await addWait(makeDb(baseGraph()))
    expect(redisStore.size).toBe(0)
    serviceUpdate.mockClear()

    // Blocked by the mail-trigger guard → applied: false, nothing persisted,
    // and the turn must NOT be marked as having written anything.
    mailGuard.mockRejectedValue(new UnprocessableEntityError('personal channel'))
    const rejected = await addWait(makeDb(baseGraph()), TURN_A)
    expect(rejected.isOk()).toBe(true)
    expect(rejected._unsafeUnwrap().applied).toBe(false)
    expect(await readWorkflowTurnSnapshot(APP, TURN_A)).toBeNull()
    expect(serviceUpdate).not.toHaveBeenCalled()
  })
})

describe('revert / finalize lifecycle', () => {
  it('a failed turn restores the exact prior graph through the persist seam', async () => {
    const graph = baseGraph()
    await addWait(makeDb(graph), TURN_A)
    serviceUpdate.mockClear()
    publishWorkflowDraftUpdated.mockClear()

    // The draft now holds the mutated graph; revert must write back the original.
    const mutated = { ...baseGraph(), nodes: [...baseGraph().nodes] }
    mutated.nodes.push({
      id: 'wait-zzzzzzzzzzzzzzzzzzzzz',
      type: 'standard',
      position: { x: 500, y: 200 },
      data: { id: 'wait-zzzzzzzzzzzzzzzzzzzzz', type: 'wait', title: 'Wait A Bit' },
    })
    const db = makeDb(mutated)

    const reverted = await revertWorkflowTurn(db, scope(), TURN_A)
    expect(reverted.isOk()).toBe(true)

    const input = serviceUpdate.mock.calls.at(-1)?.[1] as Record<string, unknown>
    const written = input.graph as DraftGraph
    expect(written.nodes.map((n) => n.id)).toEqual([TRIGGER_ID])
    expect(written.edges).toEqual([])
    // CAS token from the CURRENT draft — a write racing the revert 409s.
    expect(input.expectedGraphHash).toBe(hashWorkflowGraph(mutated))

    // Snapshot consumed; the refresh signal fired as machinery, not an edit.
    expect(await readWorkflowTurnSnapshot(APP, TURN_A)).toBeNull()
    expect(publishWorkflowDraftUpdated).toHaveBeenCalledTimes(1)
    expect(publishWorkflowDraftUpdated.mock.calls[0]?.[2]).toEqual({
      workflowAppId: APP,
      reason: 'system',
    })
  })

  it('rejects a stale snapshot from a PRIOR turn — never restores it', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    // A newer turn supersedes the slot.
    await addWait(makeDb(baseGraph()), TURN_B, 'Wait Later')
    serviceUpdate.mockClear()

    const reverted = await revertWorkflowTurn(makeDb(baseGraph()), scope(), TURN_A)
    expect(reverted.isErr()).toBe(true)
    expect(reverted._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(serviceUpdate).not.toHaveBeenCalled()
    // Turn B's snapshot is untouched.
    expect((await readWorkflowTurnSnapshot(APP, TURN_B))?.turnId).toBe(TURN_B)
  })

  it('reverting a turn that never wrote reports there is nothing to revert', async () => {
    const reverted = await revertWorkflowTurn(makeDb(baseGraph()), scope(), TURN_A)
    expect(reverted.isErr()).toBe(true)
    expect(reverted._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(reverted._unsafeUnwrapErr().message).toContain('never wrote')
  })

  it('finalize discards only the OWN turn snapshot, never a fresher one', async () => {
    await addWait(makeDb(baseGraph()), TURN_B)
    await finalizeWorkflowTurn(APP, TURN_A) // stale finalize — must be a no-op
    expect((await readWorkflowTurnSnapshot(APP, TURN_B))?.turnId).toBe(TURN_B)

    await finalizeWorkflowTurn(APP, TURN_B)
    expect(await readWorkflowTurnSnapshot(APP, TURN_B)).toBeNull()
  })
})

describe('workflow:draft-updated signal', () => {
  it('fires AFTER a successful persist with the event shape', async () => {
    const result = await addWait(makeDb(baseGraph()), TURN_A)
    expect(result.isOk()).toBe(true)

    expect(publishWorkflowDraftUpdated).toHaveBeenCalledTimes(1)
    const [, organizationId, data] = publishWorkflowDraftUpdated.mock.calls[0] ?? []
    expect(organizationId).toBe(ORG)
    const addedId = result._unsafeUnwrap().node?.id
    expect(data).toEqual({ workflowAppId: APP, nodeIds: [addedId], reason: 'kopilot' })
    // The persist happened BEFORE the signal.
    expect(serviceUpdate).toHaveBeenCalledTimes(1)
  })

  it("reports reason 'system' for non-turn callers", async () => {
    await addWait(makeDb(baseGraph()))
    expect(publishWorkflowDraftUpdated.mock.calls[0]?.[2]).toMatchObject({ reason: 'system' })
  })

  it('does NOT fire when the mutation is rejected before persisting', async () => {
    mailGuard.mockRejectedValue(new UnprocessableEntityError('personal channel'))
    const rejected = await addWait(makeDb(baseGraph()), TURN_A)
    expect(rejected._unsafeUnwrap().applied).toBe(false)
    expect(publishWorkflowDraftUpdated).not.toHaveBeenCalled()

    publishWorkflowDraftUpdated.mockClear()
    mailGuard.mockResolvedValue(undefined)
    const badRef = await addNode(makeDb(baseGraph()), {
      ...scope(TURN_A),
      type: 'wait',
      after: 'No Such Node',
    })
    expect(badRef.isErr()).toBe(true)
    expect(publishWorkflowDraftUpdated).not.toHaveBeenCalled()
  })
})

describe('hash-CAS surfacing (07 §6)', () => {
  it('sends the loaded graph hash as the CAS token — never an unconditional write', async () => {
    const graph = baseGraph()
    await addWait(makeDb(graph))
    const input = serviceUpdate.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(input.expectedGraphHash).toBe(hashWorkflowGraph(graph))
  })

  it('surfaces a concurrent-save conflict as a typed, actionable ConflictError', async () => {
    serviceUpdate.mockRejectedValue(
      new ConflictError('The draft of workflow "My Flow" changed while you were editing.')
    )
    const result = await addWait(makeDb(baseGraph()), TURN_A)
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.statusCode).toBe(409)
    expect(error.message).toMatch(/re-read/i)
    expect(error.message).toMatch(/retry/i)
    // No refresh signal for a write that never landed.
    expect(publishWorkflowDraftUpdated).not.toHaveBeenCalled()
  })
})
