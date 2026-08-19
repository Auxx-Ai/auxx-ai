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
import { hashGraphSemantics, hashWorkflowGraph } from '../../graph-hash'

// Partial mock — the cache barrel is imported by half of lib; replacing it
// wholesale dies at collection. Only the read the graph-edit path makes is stubbed.
const getCachedResources = vi.fn()
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
  // No installed apps: these suites exercise CORE node types, so the manifest
  // lookup `loadDraftContext` builds must resolve to the registry alone.
  getCachedInstalledApps: async () => [],
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
const {
  finalizeWorkflowTurn,
  readWorkflowTurnSnapshot,
  recordWorkflowTurnEnding,
  revertWorkflowTurn,
} = await import('../turn-snapshot')

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
    description: 'Original description',
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
  // `WorkflowService.update` returns `hashWorkflowGraph` of the row it just
  // wrote — the same function `loadDraftContext` runs over the stored column.
  // The fake must keep that identity or the post-turn hash means nothing.
  serviceUpdate.mockImplementation(async (_org: string, input: Record<string, unknown>) => ({
    graphHash: input.graph ? hashWorkflowGraph(input.graph) : null,
    triggerType: input.triggerType ?? null,
    entityDefinitionId: input.entityDefinitionId ?? null,
  }))
})

/** The graph the last persist actually wrote — i.e. what the canvas now holds. */
const persistedGraph = (): DraftGraph =>
  (serviceUpdate.mock.calls.at(-1)?.[1] as { graph: DraftGraph }).graph

describe('turn snapshot capture', () => {
  it('captures the PRE-edit graph on the first mutation of a turn', async () => {
    const graph = baseGraph()
    const result = await addWait(makeDb(graph), TURN_A)
    expect(result.isOk()).toBe(true)

    const snapshot = await readWorkflowTurnSnapshot(APP, TURN_A)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.turnId).toBe(TURN_A)
    expect(snapshot?.name).toBe('My Flow')
    expect(snapshot?.description).toBe('Original description')
    expect(snapshot?.triggerType).toBe('scheduled')
    // The snapshot is the graph BEFORE the mutation — one node, no wait.
    expect(snapshot?.graph.nodes.map((n) => n.id)).toEqual([TRIGGER_ID])
    expect(snapshot?.graph.edges).toEqual([])
  })

  it('does NOT overwrite the snapshot on a second mutation of the same turn', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    const first = await readWorkflowTurnSnapshot(APP, TURN_A)

    // Second mutation of the SAME turn, on the now-grown draft.
    const grown = persistedGraph()
    const result = await addNode(makeDb(grown), {
      ...scope(TURN_A),
      type: 'wait',
      title: 'Wait Again',
      after: 'Wait A Bit',
    })
    expect(result.isOk()).toBe(true)

    const second = await readWorkflowTurnSnapshot(APP, TURN_A)
    // Still the turn's ORIGINAL pre-edit state — everything the capture owns
    // is byte-identical.
    expect({ ...second, postTurnGraphSemanticHash: undefined }).toEqual({
      ...first,
      postTurnGraphSemanticHash: undefined,
    })
    expect(second?.graph.nodes).toHaveLength(1)
    // ...but the post-turn hash tracks the LATEST write, not the first.
    expect(second?.postTurnGraphSemanticHash).toBe(hashGraphSemantics(persistedGraph()))
    expect(second?.postTurnGraphSemanticHash).not.toBe(first?.postTurnGraphSemanticHash)
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

    // The draft now holds exactly what the turn wrote — an untouched canvas.
    const mutated = persistedGraph()
    serviceUpdate.mockClear()
    publishWorkflowDraftUpdated.mockClear()
    const db = makeDb(mutated)

    const reverted = await revertWorkflowTurn(db, scope(), TURN_A)
    expect(reverted.isOk()).toBe(true)

    const input = serviceUpdate.mock.calls.at(-1)?.[1] as Record<string, unknown>
    const written = input.graph as DraftGraph
    expect(written.nodes.map((n) => n.id)).toEqual([TRIGGER_ID])
    expect(written.edges).toEqual([])
    expect(input.name).toBe('My Flow')
    expect(input.description).toBe('Original description')
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

/**
 * Plan 20 §5 / [C3] + §10.4. `persistDraft`'s CAS token is read fresh
 * microseconds before the write, so it guards a race INSIDE the revert and
 * nothing across time. Because phase D makes the revert a user-clickable Undo
 * that can fire minutes later, the snapshot carries the hash of the graph the
 * turn LEFT BEHIND, and the revert refuses when the live draft no longer
 * matches it.
 */
describe('post-turn hash guard', () => {
  /** A hand edit landing on the canvas after the turn stopped writing. */
  function withExtraNode(graph: DraftGraph): DraftGraph {
    return {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: 'wait-yyyyyyyyyyyyyyyyyyyyy',
          type: 'standard',
          position: { x: 900, y: 200 },
          data: { id: 'wait-yyyyyyyyyyyyyyyyyyyyy', type: 'wait', title: 'Human Edit' },
        },
      ],
    }
  }

  it('stamps the hash of what the write actually stored', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    const snapshot = await readWorkflowTurnSnapshot(APP, TURN_A)
    expect(snapshot?.postTurnGraphSemanticHash).toBe(hashGraphSemantics(persistedGraph()))
    // Never the PRE-turn graph — that is what `graph` already holds.
    expect(snapshot?.postTurnGraphSemanticHash).not.toBe(hashGraphSemantics(baseGraph()))
  })

  it('does not stamp for a non-turn caller (no snapshot to stamp)', async () => {
    await addWait(makeDb(baseGraph()))
    expect(redisStore.size).toBe(0)
  })

  it('refuses with a ConflictError when the canvas changed after the turn', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    const divergent = withExtraNode(persistedGraph())
    serviceUpdate.mockClear()
    publishWorkflowDraftUpdated.mockClear()

    const reverted = await revertWorkflowTurn(makeDb(divergent), scope(), TURN_A)
    expect(reverted.isErr()).toBe(true)
    const error = reverted._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.statusCode).toBe(409)
    expect(error.details.reason).toBe('canvas-changed-since-turn')
    expect(error.message).toMatch(/changed since that turn finished/i)
    expect(error.message).toMatch(/nothing was reverted/i)

    // The pre-turn graph was NOT restored, and no canvas was told to refetch.
    expect(serviceUpdate).not.toHaveBeenCalled()
    expect(publishWorkflowDraftUpdated).not.toHaveBeenCalled()
    // The snapshot is left in place — refusing must not destroy the record.
    expect((await readWorkflowTurnSnapshot(APP, TURN_A))?.turnId).toBe(TURN_A)
  })

  it('the two refusals are distinguishable by class and status', async () => {
    // (a) canvas moved on → 409
    await addWait(makeDb(baseGraph()), TURN_A)
    const divergent = withExtraNode(persistedGraph())
    const conflict = (
      await revertWorkflowTurn(makeDb(divergent), scope(), TURN_A)
    )._unsafeUnwrapErr()

    // (b) snapshot gone (manual save cleared it / TTL / superseded turn) → 404
    redisStore.clear()
    const missing = (
      await revertWorkflowTurn(makeDb(divergent), scope(), TURN_A)
    )._unsafeUnwrapErr()

    expect(conflict).toBeInstanceOf(ConflictError)
    expect(conflict).not.toBeInstanceOf(NotFoundError)
    expect(missing).toBeInstanceOf(NotFoundError)
    expect(missing).not.toBeInstanceOf(ConflictError)
    expect([conflict.statusCode, missing.statusCode]).toEqual([409, 404])
    expect(conflict.message).not.toBe(missing.message)
  })

  it('reverts a canvas that only the turn touched, hash and all', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    const untouched = persistedGraph()
    serviceUpdate.mockClear()

    const reverted = await revertWorkflowTurn(makeDb(untouched), scope(), TURN_A)
    expect(reverted.isOk()).toBe(true)
    const written = (serviceUpdate.mock.calls.at(-1)?.[1] as { graph: DraftGraph }).graph
    expect(written.nodes.map((n) => n.id)).toEqual([TRIGGER_ID])
  })

  it('compares against the LAST write of the turn, not the first', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    const afterFirst = persistedGraph()
    // Same turn writes again — the canvas the user is left looking at is this one.
    await addNode(makeDb(afterFirst), {
      ...scope(TURN_A),
      type: 'wait',
      title: 'Wait Again',
      after: 'Wait A Bit',
    })
    const afterSecond = persistedGraph()
    serviceUpdate.mockClear()

    // A canvas still sitting on the FIRST write is a diverged canvas.
    const stale = await revertWorkflowTurn(makeDb(afterFirst), scope(), TURN_A)
    expect(stale._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(serviceUpdate).not.toHaveBeenCalled()

    // Reverting against the turn's FINAL graph is what succeeds.
    expect((await revertWorkflowTurn(makeDb(afterSecond), scope(), TURN_A)).isOk()).toBe(true)
  })

  it('fails OPEN for a snapshot captured before the hash was recorded', async () => {
    // A snapshot written by the previous deploy: no `postTurnGraphSemanticHash`. It
    // must still be undoable — unknown never turns into a hard refusal.
    redisStore.set(`workflow:graph:${APP}:preturn`, {
      turnId: TURN_A,
      name: 'My Flow',
      description: 'Original description',
      graph: baseGraph(),
      triggerType: 'scheduled',
      capturedAt: Date.now(),
    })

    const divergent = withExtraNode(baseGraph())
    const reverted = await revertWorkflowTurn(makeDb(divergent), scope(), TURN_A)
    expect(reverted.isOk()).toBe(true)
    expect(serviceUpdate).toHaveBeenCalledTimes(1)
  })

  it('survives a turn that never finalized — the snapshot stays undoable', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    const afterTurn = persistedGraph()
    // Turn dies: no `finalizeWorkflowTurn`, no automatic revert (plan 20 §2).
    const snapshot = await readWorkflowTurnSnapshot(APP, TURN_A)
    expect(snapshot?.turnId).toBe(TURN_A)
    expect(snapshot?.postTurnGraphSemanticHash).toBe(hashGraphSemantics(afterTurn))

    // ...and a much later Undo still works against the untouched canvas.
    serviceUpdate.mockClear()
    expect((await revertWorkflowTurn(makeDb(afterTurn), scope(), TURN_A)).isOk()).toBe(true)
    expect(await readWorkflowTurnSnapshot(APP, TURN_A)).toBeNull()
  })
})

/**
 * Plan 20 §5 / §9 phase D — "the turn says why it stopped". The snapshot is a
 * graph, not a transcript, so the ONLY way the Undo offer can name a reason is
 * a label written at turn end. Three rules: it labels its own turn, it can
 * never relabel a fresher one, and its absence is inert.
 */
describe('turn-ending stamp', () => {
  it('labels the turn’s own snapshot without disturbing anything else', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    const before = await readWorkflowTurnSnapshot(APP, TURN_A)

    await recordWorkflowTurnEnding(APP, TURN_A, 'exhausted')

    const after = await readWorkflowTurnSnapshot(APP, TURN_A)
    expect(after?.endedAs).toBe('exhausted')
    // ADDITIVE, not a finalize: the snapshot, its pre-turn graph and the
    // post-turn hash the revert guards on all survive untouched ([C4]).
    expect(after?.turnId).toBe(TURN_A)
    expect(after?.graph).toEqual(before?.graph)
    expect(after?.postTurnGraphSemanticHash).toBe(before?.postTurnGraphSemanticHash)
    expect(after?.capturedAt).toBe(before?.capturedAt)
  })

  it.each([
    'exhausted',
    'aborted',
    'error',
  ] as const)('records %s verbatim — the banner’s wording is derived, never guessed', async (ending) => {
    await addWait(makeDb(baseGraph()), TURN_A)
    await recordWorkflowTurnEnding(APP, TURN_A, ending)
    expect((await readWorkflowTurnSnapshot(APP, TURN_A))?.endedAs).toBe(ending)
  })

  it('a stale turn cannot stamp a fresher turn’s slot', async () => {
    await addWait(makeDb(baseGraph()), TURN_B)
    // Turn A ended late, after B already superseded the slot. Its ending
    // describes a turn whose snapshot is gone — writing it here would put a
    // wrong reason on the offer the user is actually looking at.
    await recordWorkflowTurnEnding(APP, TURN_A, 'error')
    const snapshot = await readWorkflowTurnSnapshot(APP, TURN_B)
    expect(snapshot?.turnId).toBe(TURN_B)
    expect(snapshot?.endedAs).toBeUndefined()
  })

  it('stamping a turn that never wrote creates nothing to undo', async () => {
    await recordWorkflowTurnEnding(APP, TURN_A, 'aborted')
    expect(redisStore.size).toBe(0)
    expect(await readWorkflowTurnSnapshot(APP, TURN_A)).toBeNull()
  })

  it('a failed stamp is swallowed and leaves the offer intact', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    const redis = await import('@auxx/redis')
    const setRedisData = vi.mocked(redis.setRedisData)
    setRedisData.mockRejectedValueOnce(new Error('redis down'))

    // Best-effort: turn end must not throw, and the cost of the failure is the
    // adjective — never the Undo.
    await expect(recordWorkflowTurnEnding(APP, TURN_A, 'exhausted')).resolves.toBeUndefined()
    const snapshot = await readWorkflowTurnSnapshot(APP, TURN_A)
    expect(snapshot?.endedAs).toBeUndefined()
    expect((await revertWorkflowTurn(makeDb(persistedGraph()), scope(), TURN_A)).isOk()).toBe(true)
  })

  it('an unlabelled snapshot is still fully undoable — absence never gates the offer', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    // No stamp at all: pre-deploy snapshot, or a turn that died before its
    // turn-end hook ran.
    expect((await readWorkflowTurnSnapshot(APP, TURN_A))?.endedAs).toBeUndefined()
    expect((await revertWorkflowTurn(makeDb(persistedGraph()), scope(), TURN_A)).isOk()).toBe(true)
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

/**
 * Plan 20 F5 — reproduced in the browser 2026-08-19. Merely OPENING the builder
 * fires an autosave carrying a fresh `viewport` and `selected: true` over
 * byte-identical node content. Both the snapshot clear and the revert guard used
 * to key off the full-document hash, so that phantom save destroyed the Undo
 * offer about eight seconds after it appeared — without the user touching
 * anything.
 *
 * These pin the distinction the fix rests on: presentation churn is not an edit,
 * but anything the user actually authored still is.
 */
describe('F5 — presentation churn is not an authored change', () => {
  /** What React Flow rewrites just from the canvas being looked at. */
  const withPresentationChurn = (g: DraftGraph): DraftGraph => ({
    ...g,
    viewport: { x: -124.9, y: 70.25, zoom: 0.7 },
    nodes: g.nodes.map((n) => ({
      ...n,
      selected: true,
      dragging: false,
      width: 244,
      height: 100,
    })),
  })

  it('hashes identically across selection, drag-state, measurement and viewport', () => {
    const base = baseGraph()
    expect(hashGraphSemantics(withPresentationChurn(base))).toBe(hashGraphSemantics(base))
    // The full-document hash is what made this a bug — it disagrees. Keep that
    // contrast pinned: `hashWorkflowGraph` MUST stay whole-document, because two
    // tabs disagreeing about the viewport is still a real save conflict.
    expect(hashWorkflowGraph(withPresentationChurn(base))).not.toBe(hashWorkflowGraph(base))
  })

  it('still sees a real edit — a moved node, a changed title, a new node', () => {
    const base = baseGraph()
    const baseHash = hashGraphSemantics(base)

    const moved = {
      ...base,
      nodes: base.nodes.map((n, i) => (i === 0 ? { ...n, position: { x: 1, y: 2 } } : n)),
    }
    expect(hashGraphSemantics(moved)).not.toBe(baseHash)

    const retitled = {
      ...base,
      nodes: base.nodes.map((n, i) =>
        i === 0 ? { ...n, data: { ...n.data, title: 'Renamed by hand' } } : n
      ),
    }
    expect(hashGraphSemantics(retitled)).not.toBe(baseHash)

    const added = {
      ...base,
      nodes: [...base.nodes, { ...base.nodes[0]!, id: 'brand-new-node' }],
    }
    expect(hashGraphSemantics(added)).not.toBe(baseHash)
  })

  it('a revert survives a canvas that was only opened, and still refuses a real edit', async () => {
    await addWait(makeDb(baseGraph()), TURN_A)
    const afterTurn = persistedGraph()

    // The phantom autosave: same content, new viewport + selection.
    const opened = withPresentationChurn(afterTurn)
    const survives = await revertWorkflowTurn(makeDb(opened), scope(), TURN_A)
    expect(survives.isOk()).toBe(true)

    // And the guard still bites on an actual hand edit.
    await addWait(makeDb(baseGraph()), TURN_B)
    const edited = {
      ...persistedGraph(),
      nodes: persistedGraph().nodes.map((n, i) =>
        i === 0 ? { ...n, position: { x: 999, y: 999 } } : n
      ),
    }
    const refused = await revertWorkflowTurn(makeDb(edited), scope(), TURN_B)
    expect(refused.isErr()).toBe(true)
    expect(refused._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
  })
})
