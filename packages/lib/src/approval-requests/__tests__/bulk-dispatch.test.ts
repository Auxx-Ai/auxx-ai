// packages/lib/src/approval-requests/__tests__/bulk-dispatch.test.ts
//
// The `bulk-dispatch` kind (plan events/03 §9, D-19): creation shape, the
// resolve path THROUGH the real registry (claim → run-row stamp in the claim tx
// → post-commit chunked enqueue), and the H5 token-lane refusal.
//
// Structured after `resolve-approval-request.test.ts`: the registry and the kind
// handler are REAL — only their lazily-imported boundaries (enqueue seam,
// resource fetcher, cache, notifications) are stubbed.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Real schema barrel so Drizzle predicates over ApprovalRequest / the run tables
// can be built (the shared setup's schema proxy has column-less tables). See the
// NOTE in resolve-approval-request.test.ts about the deep relative import.
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  const enums = await import('../../../../database/src/enums')
  return { schema, ...enums, database: {} }
})

const enqueueWorkflowTriggerJobs = vi.fn(async () => undefined)
vi.mock('../../events/handlers/trigger-resource-workflows', () => ({
  enqueueWorkflowTriggerJobs: (...args: unknown[]) =>
    (enqueueWorkflowTriggerJobs as unknown as (...a: unknown[]) => Promise<void>)(...args),
}))

const fetchResourceById = vi.fn(async () => ({ id: 'resource' }))
vi.mock('../../resources/resource-fetcher', () => ({
  fetchResourceById: (...args: unknown[]) =>
    (fetchResourceById as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}))

const roleMap: Record<string, { role: string; userType: string }> = {}
vi.mock('../../cache', () => ({
  getOrgCache: () => ({ get: async () => roleMap }),
}))

// The shared resolve-path boundaries, mocked as in resolve-approval-request.test.ts.
const publishLater = vi.fn(async () => undefined)
vi.mock('../../events/publisher', () => ({ publisher: { publishLater } }))
vi.mock('../../jobs/queues', () => ({
  Queues: { workflowDelayQueue: 'workflowDelayQueue' },
  getQueue: () => ({ getJob: async () => null }),
}))
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishApprovalResolved: vi.fn(async () => {}),
}))
vi.mock('../../notifications/notification-service', () => ({
  NotificationService: class {
    deleteNotificationsByTarget = vi.fn(async () => 0)
  },
}))
vi.mock('../approval-recipients', () => ({
  getApprovalAssigneeUserIds: vi.fn(async () => []),
}))
const recordAudit = vi.fn(() => Promise.resolve({ isErr: () => false }))
vi.mock('../../audit-log', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordAudit: (...args: unknown[]) => recordAudit(...(args as [])),
}))

const HELD_ENTRY = {
  workflowId: 'wf_A',
  workflowAppId: 'app_A',
  workflowName: 'Welcome sequence',
  triggerType: 'created' as const,
  entityDefinitionId: 'def_a',
  recordIds: Array.from({ length: 60 }, (_, i) => `def_a:r${i}`),
  count: 60,
  status: 'held' as const,
  approvalRequestId: 'req-1',
}

const OTHER_ENTRY = {
  workflowId: 'wf_B',
  workflowAppId: 'app_B',
  triggerType: 'created' as const,
  entityDefinitionId: 'def_a',
  count: 5,
  status: 'auto' as const,
}

const BULK_ROW = {
  id: 'req-1',
  organizationId: 'org1',
  kind: 'bulk-dispatch' as const,
  status: 'pending',
  workflowRunId: null,
  nodeId: null,
  assigneeUsers: ['admin1', 'actor1'],
  assigneeGroups: [],
  expiresAt: null,
  responses: [],
  subjectLabel: "'Welcome sequence' · 60 records held from sync run",
  metadata: { source: 'connector', ref: 'run_1', workflowId: 'wf_A' },
}

/**
 * Fake db serving BOTH halves of a bulk-dispatch decision: the ApprovalRequest
 * claim (`update … returning`) and the run-row read + stamp inside the same tx.
 * Update chains are thenable so the run-row `await update().set().where()` (no
 * `.returning()`) resolves.
 */
function makeDb(requestRow: Record<string, unknown>, runRow: { heldDispatches: unknown } | null) {
  const calls = {
    sets: [] as Array<Record<string, unknown>>,
    responseInserts: [] as unknown[],
    runQueries: { connector: 0, import: 0 },
  }
  const db: Record<string, unknown> = {
    query: {
      ApprovalRequest: { findFirst: async () => ({ ...requestRow }) },
      DataConnectorRun: {
        findFirst: async () => {
          calls.runQueries.connector++
          return runRow
        },
      },
      ImportJob: {
        findFirst: async () => {
          calls.runQueries.import++
          return runRow
        },
      },
    },
    update: () => {
      const chain: Record<string, unknown> = {}
      chain.set = (v: Record<string, unknown>) => {
        calls.sets.push(v)
        return chain
      }
      chain.where = () => chain
      chain.returning = async () => [
        { ...requestRow, status: (calls.sets.find((s) => s.status) as { status: string }).status },
      ]
      ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(undefined)
      return chain
    },
    insert: () => {
      const chain: Record<string, unknown> = {}
      chain.values = (v: unknown) => {
        calls.responseInserts.push(v)
        return chain
      }
      chain.returning = async () => [{ id: 'new-req' }]
      ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(undefined)
      return chain
    },
  }
  db.transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  return { db, calls }
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchResourceById.mockResolvedValue({ id: 'resource' })
  for (const key of Object.keys(roleMap)) delete roleMap[key]
})

describe('resolution through the registry', () => {
  it('APPROVE stamps the run-row entry approved in the claim tx and enqueues chunked after commit', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db, calls } = makeDb(BULK_ROW, { heldDispatches: [OTHER_ENTRY, HELD_ENTRY] })

    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'admin1',
      action: 'approve',
    })

    expect(result._unsafeUnwrap()).toMatchObject({ success: true })
    // The claim…
    expect(calls.sets.find((s) => s.status)).toMatchObject({ status: 'approved' })
    // …and the run-row stamp, in the SAME transaction. Untouched entries survive.
    const stamp = calls.sets.find((s) => s.heldDispatches) as {
      heldDispatches: Array<Record<string, unknown>>
    }
    expect(stamp).toBeDefined()
    const byId = new Map(stamp.heldDispatches.map((e) => [e.workflowId, e]))
    expect(byId.get('wf_A')).toMatchObject({ status: 'approved', count: 60 })
    expect(byId.get('wf_B')).toMatchObject({ status: 'auto' })

    // Post-commit: every held record dispatched through the shared enqueue seam.
    expect(fetchResourceById).toHaveBeenCalledTimes(60)
    expect(enqueueWorkflowTriggerJobs).toHaveBeenCalledTimes(60)
    expect(
      (enqueueWorkflowTriggerJobs.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]
    ).toMatchObject({
      organizationId: 'org1',
      targets: [
        {
          workflowAppId: 'app_A',
          workflowId: 'wf_A',
          triggerType: 'created',
          jobEntityDefinitionId: 'def_a',
        },
      ],
    })
  })

  it('DENY stamps the entry skipped and enqueues NOTHING', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db, calls } = makeDb(BULK_ROW, { heldDispatches: [HELD_ENTRY] })

    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'admin1',
      action: 'deny',
    })

    expect(result._unsafeUnwrap()).toMatchObject({ success: true })
    const stamp = calls.sets.find((s) => s.heldDispatches) as {
      heldDispatches: Array<Record<string, unknown>>
    }
    expect(stamp.heldDispatches[0]).toMatchObject({ status: 'skipped' })
    expect(enqueueWorkflowTriggerJobs).not.toHaveBeenCalled()
    expect(fetchResourceById).not.toHaveBeenCalled()
  })

  it('a run with no still-held entry for the workflow refuses — the claim rolls back', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db } = makeDb(BULK_ROW, { heldDispatches: [{ ...HELD_ENTRY, status: 'skipped' }] })

    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'admin1',
      action: 'approve',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/no longer holds/i)
    expect(enqueueWorkflowTriggerJobs).not.toHaveBeenCalled()
  })

  it('an import-source request reads/stamps the ImportJob row, not the connector run', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const importRow = {
      ...BULK_ROW,
      metadata: { source: 'import', ref: 'job_1', workflowId: 'wf_A' },
    }
    const { db, calls } = makeDb(importRow, { heldDispatches: [HELD_ENTRY] })

    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'admin1',
      action: 'deny',
    })

    expect(result._unsafeUnwrap()).toMatchObject({ success: true })
    expect(calls.runQueries.import).toBe(1)
    expect(calls.runQueries.connector).toBe(0)
  })

  it('a vanished run row refuses the decision', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db } = makeDb(BULK_ROW, null)
    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'admin1',
      action: 'approve',
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/no longer exists/i)
  })
})

describe('token lane (plan 28 H5 / plan events/03 D-19)', () => {
  it('the registry refuses token resolution for bulk-dispatch', async () => {
    const { allowsTokenResolution } = await import('../registry')
    expect(allowsTokenResolution('bulk-dispatch')).toBe(false)
  })

  it('an unauthenticated token resolve on a bulk-dispatch row is rejected and writes nothing', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db, calls } = makeDb(BULK_ROW, { heldDispatches: [HELD_ENTRY] })

    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'admin1',
      action: 'approve',
      viaToken: true,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/email link/i)
    expect(calls.sets).toHaveLength(0)
    expect(calls.responseInserts).toHaveLength(0)
    expect(enqueueWorkflowTriggerJobs).not.toHaveBeenCalled()
  })
})

describe('createBulkDispatchRequest', () => {
  const input = {
    organizationId: 'org1',
    source: 'connector' as const,
    ref: 'run_1',
    workflowId: 'wf_A',
    workflowName: 'Welcome sequence',
    count: 8412,
    actorUserId: 'actor1',
  }

  it('files one pending request: actor + admins audience, run pointer in metadata, no expiry', async () => {
    const { createBulkDispatchRequest } = await import('../bulk-dispatch-mutations')
    Object.assign(roleMap, {
      admin1: { role: 'ADMIN', userType: 'USER' },
      owner1: { role: 'OWNER', userType: 'USER' },
      member1: { role: 'MEMBER', userType: 'USER' },
      agent1: { role: 'ADMIN', userType: 'AGENT' },
      actor1: { role: 'MEMBER', userType: 'USER' },
    })
    const { db, calls } = makeDb(BULK_ROW, null)

    const result = await createBulkDispatchRequest(db as never, input)

    expect(result._unsafeUnwrap()).toBe('new-req')
    expect(calls.responseInserts).toHaveLength(1)
    const values = calls.responseInserts[0] as Record<string, unknown>
    expect(values).toMatchObject({
      organizationId: 'org1',
      kind: 'bulk-dispatch',
      status: 'pending',
      createdById: 'actor1',
      metadata: { source: 'connector', ref: 'run_1', workflowId: 'wf_A' },
      assigneeGroups: [],
    })
    // Admins + owner + the initiator; never members, never agent users.
    expect([...(values.assigneeUsers as string[])].sort()).toEqual(['actor1', 'admin1', 'owner1'])
    expect(values.subjectLabel).toContain('Welcome sequence')
    expect(values.subjectLabel).toContain('8412')
    // No expiry: a lapsed request would strand the run entry 'held' forever.
    expect(values.expiresAt).toBeUndefined()
  })

  it('falls back to an admin as createdById when the run has no attributable actor', async () => {
    const { createBulkDispatchRequest } = await import('../bulk-dispatch-mutations')
    Object.assign(roleMap, { admin1: { role: 'ADMIN', userType: 'USER' } })
    const { db, calls } = makeDb(BULK_ROW, null)

    const result = await createBulkDispatchRequest(db as never, { ...input, actorUserId: null })

    expect(result._unsafeUnwrap()).toBe('new-req')
    expect(calls.responseInserts[0]).toMatchObject({ createdById: 'admin1' })
  })

  it('creates nothing when there is nobody to ask', async () => {
    const { createBulkDispatchRequest } = await import('../bulk-dispatch-mutations')
    const { db, calls } = makeDb(BULK_ROW, null)
    const result = await createBulkDispatchRequest(db as never, { ...input, actorUserId: null })
    expect(result._unsafeUnwrap()).toBeNull()
    expect(calls.responseInserts).toHaveLength(0)
  })
})
