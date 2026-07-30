// packages/lib/src/approval-requests/__tests__/resolve-approval-request.test.ts
//
// Plan 42 §4.1 (the atomic decision claim) + plan 28 H4 (kind dispatch) and H5
// (the unauthenticated email-token lane must hard-reject `kind='access'`).
//
// The registry is REAL here — H5 is meant to be a property of the handler rather
// than an `if` in the router, so a test that mocked the registry would prove
// nothing. Only the two handlers' lazily-imported side effects are stubbed.

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The default lib setup mocks `schema` as a Proxy of empty objects, which makes
// every Drizzle predicate unreadable — and the atomic claim IS a predicate. Swap in
// the REAL schema barrel (pure Drizzle, no connection) so the claim's
// `WHERE status = 'pending'` can be rendered and asserted.
// NOTE on the deep relative import: it puts `packages/database/src/**` into THIS
// package's tsc program, which surfaces ~200 of that package's own pre-existing
// errors under a `packages/lib` typecheck. That is cosmetic — `packages/lib`'s own
// `src/` count is unaffected — and the alternatives are worse: a variable specifier
// breaks Vitest's resolution, and `@auxx/database` itself is the module being
// mocked here, so it cannot also be the source of the real schema.
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  const enums = await import('../../../../database/src/enums')
  return { schema, ...enums, database: {} }
})

const resumeWorkflow = vi.fn(async () => undefined)
vi.mock('../../workflows/workflow-execution-service', () => ({
  WorkflowExecutionService: class {
    resumeWorkflow = resumeWorkflow
  },
}))

const applyAccessDecision = vi.fn(async () => ({ message: 'Access granted' }))
vi.mock('../access-request-mutations', () => ({
  applyAccessDecision: (...args: unknown[]) =>
    (applyAccessDecision as unknown as (...a: unknown[]) => Promise<{ message: string }>)(...args),
}))

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
    sendNotification = vi.fn(async () => ({}))
  },
}))
vi.mock('../approval-recipients', () => ({
  getApprovalAssigneeUserIds: vi.fn(async () => []),
}))

const WORKFLOW_ROW = {
  id: 'req-1',
  organizationId: 'org1',
  kind: 'workflow' as const,
  status: 'pending',
  workflowRunId: 'run-1',
  nodeId: 'node-1',
  assigneeUsers: ['user1', 'user2'],
  assigneeGroups: [],
  expiresAt: null,
  responses: [],
}

const ACCESS_ROW = {
  ...WORKFLOW_ROW,
  kind: 'access' as const,
  workflowRunId: null,
  nodeId: null,
  targetKind: 'instance',
  entityDefinitionId: 'thread',
  entityInstanceId: 'thread-1',
  requesterId: 'requester1',
  subjectLabel: 'Support · 2 participants · 4 messages',
  metadata: {},
}

/**
 * A db whose status claim succeeds only ONCE — the arbiter both racing approvers
 * pass through, while the advisory pre-flight read keeps reporting `pending` to
 * both (which is exactly the state that made the old unconditional UPDATE unsafe).
 */
function makeDb(row: Record<string, unknown>, opts: { claimsAvailable?: number } = {}) {
  let claimsLeft = opts.claimsAvailable ?? 1
  const calls = {
    responseInserts: [] as unknown[],
    statusSets: [] as unknown[],
    updateWheres: [] as unknown[],
  }
  const db: Record<string, unknown> = {
    query: { ApprovalRequest: { findFirst: async () => ({ ...row }) } },
    update: () => {
      const chain: Record<string, unknown> = {}
      chain.set = (v: unknown) => {
        calls.statusSets.push(v)
        return chain
      }
      chain.where = (predicate: unknown) => {
        calls.updateWheres.push(predicate)
        return chain
      }
      chain.returning = async () => {
        if (claimsLeft <= 0) return []
        claimsLeft -= 1
        return [{ ...row, status: (calls.statusSets.at(-1) as { status: string }).status }]
      }
      return chain
    },
    insert: () => {
      const chain: Record<string, unknown> = {}
      chain.values = (v: unknown) => {
        calls.responseInserts.push(v)
        return chain
      }
      ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(undefined)
      return chain
    },
  }
  db.transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  return { db, calls }
}

beforeEach(() => {
  vi.clearAllMocks()
  applyAccessDecision.mockResolvedValue({ message: 'Access granted' })
})

describe('atomic decision claim (plan 42 §4.1)', () => {
  it('the WINNER records a response, dispatches its handler, and goes terminal', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db, calls } = makeDb(WORKFLOW_ROW)

    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ success: true, nextPath: 'approved' })
    expect(calls.statusSets[0]).toMatchObject({ status: 'approved' })
    expect(calls.responseInserts).toHaveLength(1)
    expect(resumeWorkflow).toHaveBeenCalledTimes(1)
  })

  it('claims with a CONDITIONAL update — `WHERE status = pending`, not an unconditional set', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db, calls } = makeDb(WORKFLOW_ROW)
    await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
    })
    // The status transition IS the arbiter. Without the status predicate two
    // approvers who both read `pending` both write, and an Approve/Deny race can
    // apply the grant while finishing `denied`.
    const { sql, params } = new PgDialect().sqlToQuery(calls.updateWheres[0] as never)
    expect(sql).toContain('"status" =')
    expect(params).toContain('pending')
    expect(sql).toContain('"id" =')
    expect(sql.toLowerCase()).toContain(' and ')
  })

  it('the LOSER of an Approve/Deny race performs NO side effect', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    // One claim available; the second caller's conditional UPDATE returns nothing.
    const { db, calls } = makeDb(WORKFLOW_ROW, { claimsAvailable: 1 })

    const winner = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
    })
    const loser = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user2',
      action: 'deny',
    })

    expect(winner._unsafeUnwrap().success).toBe(true)
    expect(loser._unsafeUnwrap()).toMatchObject({
      success: false,
      message: 'Approval already decided',
    })
    // Exactly ONE response row and ONE handler invocation across the race.
    expect(calls.responseInserts).toHaveLength(1)
    expect(resumeWorkflow).toHaveBeenCalledTimes(1)
    expect(publishLater).toHaveBeenCalledTimes(1)
  })

  it('a DENY that wins the race never invokes the grant path', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db, calls } = makeDb(ACCESS_ROW, { claimsAvailable: 1 })

    const denier = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'deny',
    })
    const approver = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user2',
      action: 'approve',
    })

    expect(denier._unsafeUnwrap().success).toBe(true)
    expect(approver._unsafeUnwrap().success).toBe(false)
    // The grant and the terminal status cannot disagree: the only claim recorded
    // `denied`, and the handler ran exactly once — for the denial.
    expect(
      calls.statusSets.filter((s) => (s as { status?: string }).status === 'denied')
    ).toHaveLength(1)
    expect(applyAccessDecision).toHaveBeenCalledTimes(1)
    expect((applyAccessDecision.mock.calls as unknown as Array<[unknown]>)[0]![0]).toMatchObject({
      action: 'deny',
    })
  })

  it('a handler that throws rolls the decision back — no post-commit side effects', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { ForbiddenError } = await import('../../errors')
    applyAccessDecision.mockRejectedValueOnce(new ForbiddenError('stale manager') as never)
    const { db } = makeDb(ACCESS_ROW)
    // The fake db cannot roll back, but the AuxxError must surface as `err(...)`
    // rather than a success — which is what makes the real transaction abort.
    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/stale manager/)
    expect(publishLater).not.toHaveBeenCalled()
  })

  it('refuses a second response from the same approver', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db, calls } = makeDb({ ...WORKFLOW_ROW, responses: [{ userId: 'user1' }] })
    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
    })
    expect(result._unsafeUnwrap()).toMatchObject({ success: false })
    expect(calls.statusSets).toHaveLength(0)
  })

  it('refuses an already-terminal request before claiming', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db, calls } = makeDb({ ...WORKFLOW_ROW, status: 'approved' })
    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
    })
    expect(result._unsafeUnwrap().message).toMatch(/already approved/)
    expect(calls.statusSets).toHaveLength(0)
  })
})

describe('kind dispatch (plan 28 H4)', () => {
  it('an ACCESS decision does not call resumeWorkflow', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db } = makeDb(ACCESS_ROW)
    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
    })
    expect(result._unsafeUnwrap().success).toBe(true)
    expect(resumeWorkflow).not.toHaveBeenCalled()
    expect(applyAccessDecision).toHaveBeenCalledTimes(1)
  })

  it('a WORKFLOW decision still resumes on BOTH approve and deny', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    for (const action of ['approve', 'deny'] as const) {
      resumeWorkflow.mockClear()
      const { db } = makeDb(WORKFLOW_ROW)
      await resolveApprovalRequest(db as never, {
        approvalRequestId: 'req-1',
        userId: 'user1',
        action,
      })
      expect(resumeWorkflow).toHaveBeenCalledTimes(1)
      expect(
        (resumeWorkflow.mock.calls as unknown as Array<[unknown, unknown, unknown]>)[0]![2]
      ).toMatchObject({ outcome: action })
    }
  })

  it('does not invoke the access handler for a workflow row', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db } = makeDb(WORKFLOW_ROW)
    await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
    })
    expect(applyAccessDecision).not.toHaveBeenCalled()
  })
})

describe('token lane (plan 28 H5)', () => {
  it('the registry refuses token resolution for `access` and permits it for `workflow`', async () => {
    const { allowsTokenResolution } = await import('../registry')
    expect(allowsTokenResolution('access')).toBe(false)
    expect(allowsTokenResolution('workflow')).toBe(true)
  })

  it('an unauthenticated token resolve on an ACCESS row is rejected and writes nothing', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db, calls } = makeDb(ACCESS_ROW)
    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
      viaToken: true,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/email link/i)
    expect(calls.statusSets).toHaveLength(0)
    expect(calls.responseInserts).toHaveLength(0)
    expect(applyAccessDecision).not.toHaveBeenCalled()
  })

  it('a token resolve on a WORKFLOW row still works', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db, calls } = makeDb(WORKFLOW_ROW)
    const result = await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
      viaToken: true,
    })
    expect(result._unsafeUnwrap().success).toBe(true)
    expect((calls.responseInserts[0] as { responseMethod: string }).responseMethod).toBe('email')
  })

  it('an unknown kind refuses rather than defaulting to a handler', async () => {
    const { getApprovalKindHandler } = await import('../registry')
    expect(() => getApprovalKindHandler('spend_approval')).toThrow(/Unsupported approval kind/)
  })
})
