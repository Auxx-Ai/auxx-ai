// packages/lib/src/workflows/__tests__/workflow-draft-cas.test.ts

import { describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../errors'
import { hashWorkflowGraph } from '../graph-hash'

/**
 * Compare-and-swap on the workflow draft save path (`WorkflowService.update`).
 *
 * Three behaviors under test:
 *  1. stale `expectedGraphHash` → `ConflictError` (409) and NO write;
 *  2. matching `expectedGraphHash` → locked (`FOR UPDATE`) write + the new
 *     graph's hash returned so the client can chain its next save;
 *  3. absent `expectedGraphHash` → legacy unconditional write, no lock taken
 *     (template install / system callers must not change behavior).
 *
 * Heavy sibling imports of `workflow-service.ts` (BullMQ queues, the engine,
 * trigger schedulers, org cache) are stubbed per-module; `@auxx/database` and
 * the drizzle builders stay on the shared setup mocks (never fully replaced —
 * see src/test/database-mock.ts). The db handed to the service is a local fake:
 * the service takes `db` via constructor, so no global database plumbing is
 * needed.
 */

vi.mock('../../jobs/queues', () => ({
  getQueue: vi.fn(),
  Queues: {},
}))
vi.mock('../../workflow-engine/core/workflow-engine', () => ({
  WorkflowEngine: class {},
}))
vi.mock('../../cache/invalidate', () => ({
  onCacheEvent: vi.fn(async () => {}),
}))
vi.mock('../../cache/org-cache-helpers', () => ({
  getCachedResources: vi.fn(async () => []),
}))
vi.mock('../../cache/workflow-app-queries', () => ({
  getCachedWorkflowAppsList: vi.fn(async () => ({ workflows: [], total: 0 })),
}))
vi.mock('../mail-trigger-guard', () => ({
  assertMailTriggerNotPersonal: vi.fn(async () => {}),
}))
vi.mock('../polling-trigger-service', () => ({
  PollingTriggerService: class {
    schedulePollingTrigger = vi.fn()
    unschedulePollingTrigger = vi.fn()
  },
}))
vi.mock('../scheduled-trigger-service', () => ({
  ScheduledTriggerService: class {
    scheduleWorkflowTriggers = vi.fn()
    unscheduleWorkflowTriggers = vi.fn()
  },
}))

import { schema } from '@auxx/database'
import { WorkflowService } from '../workflow-service'

const ORG = 'org_1'
const APP_ID = 'app_1'
const DRAFT_ID = 'wf_draft_1'

/** The draft graph as this editor loaded it (insertion order A). */
const storedGraph = {
  nodes: [{ id: 'n1', type: 'standard', data: { type: 'manual', title: 'Start' } }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

/**
 * The same graph as Postgres `jsonb` hands it back — key order NOT preserved.
 * The CAS must treat this as identical to {@link storedGraph}.
 */
const storedGraphJsonb = {
  viewport: { zoom: 1, y: 0, x: 0 },
  edges: [],
  nodes: [{ data: { title: 'Start', type: 'manual' }, type: 'standard', id: 'n1' }],
}

const newGraph = {
  nodes: [{ id: 'n1', type: 'standard', data: { type: 'manual', title: 'Renamed' } }],
  edges: [],
  viewport: { x: 10, y: 5, zoom: 1 },
}

interface UpdateCall {
  table: unknown
  set: Record<string, unknown> | undefined
}

/** Fake transaction: records `.update()` writes and serves the FOR UPDATE read. */
function makeTx(lockedRows: Array<{ graph: unknown; version: number }>) {
  const updateCalls: UpdateCall[] = []
  const forUpdate = { count: 0, mode: undefined as unknown }

  const finalApp = {
    id: APP_ID,
    name: 'Order Sync',
    organizationId: ORG,
    draftWorkflowId: DRAFT_ID,
    workflowId: null,
    draftWorkflow: { id: DRAFT_ID, version: 4, graph: newGraph, triggerType: 'manual' },
    publishedWorkflow: null,
    createdBy: { id: 'user_1', name: 'A', email: 'a@example.com' },
  }

  const tx = {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.from = vi.fn(() => chain)
      chain.where = vi.fn(() => chain)
      chain.for = vi.fn((mode: unknown) => {
        forUpdate.count++
        forUpdate.mode = mode
        return chain
      })
      chain.limit = vi.fn(async () => lockedRows)
      return chain
    }),
    update: vi.fn((table: unknown) => {
      const call: UpdateCall = { table, set: undefined }
      updateCalls.push(call)
      const chain: Record<string, unknown> = {}
      chain.set = vi.fn((values: Record<string, unknown>) => {
        call.set = values
        return chain
      })
      chain.where = vi.fn(async () => undefined)
      return chain
    }),
    insert: vi.fn(),
    query: { WorkflowApp: { findFirst: vi.fn(async () => finalApp) } },
  }

  return { tx, updateCalls, forUpdate }
}

function makeService(tx: ReturnType<typeof makeTx>['tx']) {
  const existingApp = {
    id: APP_ID,
    name: 'Order Sync',
    organizationId: ORG,
    draftWorkflow: { id: DRAFT_ID, version: 3, graph: storedGraphJsonb, triggerType: 'manual' },
    publishedWorkflow: null,
  }
  const db = {
    query: { WorkflowApp: { findFirst: vi.fn(async () => existingApp) } },
    transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  }
  return new WorkflowService(db as never)
}

describe('hashWorkflowGraph', () => {
  it('is independent of object key order (jsonb round-trip)', () => {
    expect(hashWorkflowGraph(storedGraph)).toBe(hashWorkflowGraph(storedGraphJsonb))
  })

  it('differs for different content', () => {
    expect(hashWorkflowGraph(storedGraph)).not.toBe(hashWorkflowGraph(newGraph))
  })
})

describe('WorkflowService.update draft CAS', () => {
  it('rejects a stale expectedGraphHash with ConflictError and writes nothing', async () => {
    const { tx, updateCalls } = makeTx([{ graph: storedGraphJsonb, version: 3 }])
    const service = makeService(tx)

    const staleHash = hashWorkflowGraph(newGraph) // NOT what is stored
    const promise = service.update(ORG, {
      id: APP_ID,
      graph: newGraph,
      expectedGraphHash: staleHash,
    })

    await expect(promise).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConflictError)
      expect((error as ConflictError).statusCode).toBe(409)
      expect((error as ConflictError).message).toContain('Order Sync')
      return true
    })
    expect(updateCalls).toHaveLength(0)
  })

  it('writes under FOR UPDATE and returns the new graph hash when the hash matches', async () => {
    const { tx, updateCalls, forUpdate } = makeTx([{ graph: storedGraphJsonb, version: 3 }])
    const service = makeService(tx)

    // The hash the editor computed from its (differently key-ordered) load.
    const expectedGraphHash = hashWorkflowGraph(storedGraph)
    const result = await service.update(ORG, {
      id: APP_ID,
      graph: newGraph,
      expectedGraphHash,
    })

    expect(forUpdate.count).toBe(1)
    expect(forUpdate.mode).toBe('update')

    const draftWrite = updateCalls.find((c) => c.table === schema.Workflow)
    expect(draftWrite).toBeDefined()
    expect(draftWrite?.set?.graph).toBe(newGraph)
    // Version bump comes from the LOCKED row, not the unlocked pre-read.
    expect(draftWrite?.set?.version).toBe(4)

    expect(result.graphHash).toBe(hashWorkflowGraph(newGraph))
  })

  it('keeps the legacy unconditional write when expectedGraphHash is absent', async () => {
    const { tx, updateCalls, forUpdate } = makeTx([])
    const service = makeService(tx)

    const result = await service.update(ORG, { id: APP_ID, graph: newGraph })

    // No lock, no compare — and the write still lands.
    expect(forUpdate.count).toBe(0)
    expect(tx.select).not.toHaveBeenCalled()
    const draftWrite = updateCalls.find((c) => c.table === schema.Workflow)
    expect(draftWrite).toBeDefined()
    expect(draftWrite?.set?.graph).toBe(newGraph)
    expect(draftWrite?.set?.version).toBe(4)
    expect(result.graphHash).toBe(hashWorkflowGraph(newGraph))
  })
})
