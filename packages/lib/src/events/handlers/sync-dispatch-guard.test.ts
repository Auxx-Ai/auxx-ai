// packages/lib/src/events/handlers/sync-dispatch-guard.test.ts
// Phase 6 (plan events/03 §9, D-3/D-13/D-19): the guarded workflow dispatcher.
// Boundaries (workflow matching/enqueue, resource fetch, approval creation,
// drizzle) mocked; the tally/threshold/persist logic runs for real.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKFLOW_AUTO_DISPATCH_THRESHOLD } from '../../resources/crud/door-matrix'

type Target = {
  workflowAppId: string
  workflowId: string
  workflowName?: string
  triggerType: 'created' | 'updated' | 'deleted'
  jobEntityDefinitionId: string
}

const h = vi.hoisted(() => ({
  matchResourceWorkflowTargets: vi.fn<
    (event: {
      type: string
      data: Record<string, unknown>
    }) => Promise<{ match: Record<string, unknown>; targets: unknown[] } | null>
  >(async () => null),
  enqueueWorkflowTriggerJobs: vi.fn<
    (args: {
      organizationId: string
      targets: readonly unknown[]
      resourceData: unknown
    }) => Promise<void>
  >(async () => {}),
  fetchResourceById: vi.fn<(recordId: string, org: string) => Promise<unknown>>(async () => ({
    id: 'resource',
  })),
  // Implementation set in beforeEach — `ok`/`err` are module imports and
  // vi.hoisted runs before them.
  createBulkDispatchRequest:
    vi.fn<(db: unknown, input: Record<string, unknown>) => Promise<unknown>>(),
}))

vi.mock('./trigger-resource-workflows', () => ({
  matchResourceWorkflowTargets: h.matchResourceWorkflowTargets,
  enqueueWorkflowTriggerJobs: h.enqueueWorkflowTriggerJobs,
}))
vi.mock('../../resources/resource-fetcher', () => ({
  fetchResourceById: h.fetchResourceById,
}))
vi.mock('../../approval-requests/bulk-dispatch-mutations', () => ({
  createBulkDispatchRequest: h.createBulkDispatchRequest,
}))
// Only `eq` is used, against the shared setup's column-less schema proxy —
// partial-mock it so undefined columns can't throw (same as sync-finalize.test).
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  eq: vi.fn(() => ({})),
}))

import type { HeldDispatchEntry } from './sync-dispatch-guard'
import { runGuardedWorkflowDispatch } from './sync-dispatch-guard'

const ORG = 'org_1'

const wfA: Target = {
  workflowAppId: 'app_A',
  workflowId: 'wf_A',
  workflowName: 'Workflow A',
  triggerType: 'created',
  jobEntityDefinitionId: 'def_a',
}
const wfB: Target = {
  workflowAppId: 'app_B',
  workflowId: 'wf_B',
  workflowName: 'Workflow B',
  triggerType: 'created',
  jobEntityDefinitionId: 'def_b',
}

/** Fake db capturing `update(...).set(...).where(...)` for the persist step. */
function fakeDb() {
  const updates: Array<Record<string, unknown>> = []
  const db = {
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v)
        return { where: async () => undefined }
      },
    })),
  }
  return { db: db as never, updates }
}

/** Match mock keyed by the synthesized event's canonical def id. */
function matchByDef(targetsByDef: Record<string, Target[]>) {
  h.matchResourceWorkflowTargets.mockImplementation(async (event) => {
    const defId = event.data.entityDefinitionId as string
    const targets = targetsByDef[defId]
    if (!targets) return null
    return {
      match: { triggerType: 'created', entityDefinitionId: defId, matchIds: [defId] },
      targets,
    }
  })
}

function input(over: Partial<Parameters<typeof runGuardedWorkflowDispatch>[1]> = {}) {
  return {
    organizationId: ORG,
    source: 'connector' as const,
    ref: 'run_1',
    actorUserId: 'user_1',
    createdIds: [] as never[],
    updatedIds: [] as never[],
    canonicalDefId: async (defId: string) => defId,
    ...over,
  }
}

function ids(defId: string, n: number) {
  return Array.from({ length: n }, (_, i) => `${defId}:r${i}`) as never[]
}

function persisted(updates: Array<Record<string, unknown>>): HeldDispatchEntry[] {
  expect(updates).toHaveLength(1)
  return updates[0]!.heldDispatches as HeldDispatchEntry[]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.createBulkDispatchRequest.mockResolvedValue(ok('req_1'))
  h.fetchResourceById.mockResolvedValue({ id: 'resource' })
})

describe('runGuardedWorkflowDispatch — held (at/above the threshold)', () => {
  it('a workflow matching 100 records is HELD: nothing enqueued, approval filed, entry persisted', async () => {
    matchByDef({ def_a: [wfA] })
    const { db, updates } = fakeDb()

    await runGuardedWorkflowDispatch(db, input({ createdIds: ids('def_a', 100) }))

    expect(h.enqueueWorkflowTriggerJobs).not.toHaveBeenCalled()
    expect(h.fetchResourceById).not.toHaveBeenCalled()
    expect(h.createBulkDispatchRequest).toHaveBeenCalledTimes(1)
    expect(h.createBulkDispatchRequest.mock.calls[0]![1]).toMatchObject({
      organizationId: ORG,
      source: 'connector',
      ref: 'run_1',
      workflowId: 'wf_A',
      workflowName: 'Workflow A',
      count: 100,
      actorUserId: 'user_1',
    })

    const entries = persisted(updates)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      workflowId: 'wf_A',
      workflowAppId: 'app_A',
      triggerType: 'created',
      entityDefinitionId: 'def_a',
      count: 100,
      status: 'held',
      approvalRequestId: 'req_1',
    })
    expect(entries[0]!.recordIds).toHaveLength(100)
    expect(entries[0]!.recordIds![0]).toBe('def_a:r0')
  })

  it('exactly the threshold is held — the hold is >=, auto is strictly below', async () => {
    matchByDef({ def_a: [wfA] })
    const { db, updates } = fakeDb()
    await runGuardedWorkflowDispatch(
      db,
      input({ createdIds: ids('def_a', WORKFLOW_AUTO_DISPATCH_THRESHOLD) })
    )
    expect(h.enqueueWorkflowTriggerJobs).not.toHaveBeenCalled()
    expect(persisted(updates)[0]).toMatchObject({ status: 'held' })
  })

  it('an approval-creation failure keeps the entry held (no approvalRequestId) and never throws', async () => {
    matchByDef({ def_a: [wfA] })
    h.createBulkDispatchRequest.mockResolvedValue(err(new Error('insert boom')))
    const { db, updates } = fakeDb()

    await expect(
      runGuardedWorkflowDispatch(db, input({ createdIds: ids('def_a', 100) }))
    ).resolves.toBeUndefined()

    const entries = persisted(updates)
    expect(entries[0]).toMatchObject({ status: 'held', count: 100 })
    expect(entries[0]!.approvalRequestId).toBeUndefined()
  })
})

describe('runGuardedWorkflowDispatch — auto (below the threshold)', () => {
  it('a workflow matching 10 records auto-dispatches through the normal enqueue path (D-13)', async () => {
    matchByDef({ def_a: [wfA] })
    const { db, updates } = fakeDb()

    await runGuardedWorkflowDispatch(db, input({ createdIds: ids('def_a', 10) }))

    expect(h.createBulkDispatchRequest).not.toHaveBeenCalled()
    expect(h.fetchResourceById).toHaveBeenCalledTimes(10)
    expect(h.enqueueWorkflowTriggerJobs).toHaveBeenCalledTimes(10)
    expect(h.enqueueWorkflowTriggerJobs.mock.calls[0]![0]).toMatchObject({
      organizationId: ORG,
      targets: [wfA],
      resourceData: { id: 'resource' },
    })

    const entries = persisted(updates)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ workflowId: 'wf_A', count: 10, status: 'auto' })
    // recordIds omitted for auto — those already ran; keep the row small.
    expect(entries[0]!.recordIds).toBeUndefined()
  })

  it('a vanished record is skipped without failing the rest', async () => {
    matchByDef({ def_a: [wfA] })
    h.fetchResourceById.mockResolvedValueOnce(null)
    const { db } = fakeDb()
    await runGuardedWorkflowDispatch(db, input({ createdIds: ids('def_a', 3) }))
    expect(h.enqueueWorkflowTriggerJobs).toHaveBeenCalledTimes(2)
  })
})

describe('runGuardedWorkflowDispatch — mixed and empty runs', () => {
  it('holds one workflow and auto-dispatches the other in the SAME run (per-workflow, D-13)', async () => {
    matchByDef({ def_a: [wfA], def_b: [wfB] })
    const { db, updates } = fakeDb()

    await runGuardedWorkflowDispatch(
      db,
      input({ createdIds: [...ids('def_a', 30), ...ids('def_b', 10)] })
    )

    // Only wf_B's 10 records enqueued.
    expect(h.enqueueWorkflowTriggerJobs).toHaveBeenCalledTimes(10)
    for (const [args] of h.enqueueWorkflowTriggerJobs.mock.calls) {
      expect(args.targets).toEqual([wfB])
    }
    // Only wf_A held → one approval request.
    expect(h.createBulkDispatchRequest).toHaveBeenCalledTimes(1)
    expect(h.createBulkDispatchRequest.mock.calls[0]![1]).toMatchObject({ workflowId: 'wf_A' })

    const entries = persisted(updates)
    const byId = new Map(entries.map((e) => [e.workflowId, e]))
    expect(byId.get('wf_A')).toMatchObject({ status: 'held', count: 30 })
    expect(byId.get('wf_B')).toMatchObject({ status: 'auto', count: 10 })
  })

  it('persists an EMPTY tally — the trace that the door ran (D-3)', async () => {
    matchByDef({})
    const { db, updates } = fakeDb()
    await runGuardedWorkflowDispatch(db, input({ createdIds: ids('def_a', 5) }))
    expect(persisted(updates)).toEqual([])
    expect(h.enqueueWorkflowTriggerJobs).not.toHaveBeenCalled()
    expect(h.createBulkDispatchRequest).not.toHaveBeenCalled()
  })

  it('memoizes matching per (type, def) — record content never enters the match', async () => {
    matchByDef({ def_a: [wfA] })
    const { db } = fakeDb()
    await runGuardedWorkflowDispatch(db, input({ createdIds: ids('def_a', 10) }))
    expect(h.matchResourceWorkflowTargets).toHaveBeenCalledTimes(1)
  })

  it('a persist failure never rejects', async () => {
    matchByDef({ def_a: [wfA] })
    const db = {
      update: vi.fn(() => {
        throw new Error('update boom')
      }),
    } as never
    await expect(
      runGuardedWorkflowDispatch(db, input({ createdIds: ids('def_a', 5) }))
    ).resolves.toBeUndefined()
  })
})
