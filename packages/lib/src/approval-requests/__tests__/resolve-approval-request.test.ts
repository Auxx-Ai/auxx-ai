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

// PARTIAL mock — `AUDIT_ACTIONS` must stay real, or the assertions below pin the
// test's own copy of the action strings instead of the shipped ones.
const recordAudit = vi.fn(() => Promise.resolve({ isErr: () => false }))
vi.mock('../../audit-log', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordAudit: (...args: unknown[]) => recordAudit(...(args as [])),
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
function makeDb(
  row: Record<string, unknown>,
  opts: {
    claimsAvailable?: number
    /**
     * Opt-in: reads AFTER the transaction returns see the claimed status, which is
     * what the post-commit audit read needs. Off by default — the race tests
     * deliberately keep the advisory pre-flight reporting `pending` to both callers.
     */
    reflectClaimAfterCommit?: boolean
  } = {}
) {
  let claimsLeft = opts.claimsAvailable ?? 1
  let committed = false
  const calls = {
    responseInserts: [] as unknown[],
    statusSets: [] as unknown[],
    updateWheres: [] as unknown[],
  }
  const claimedStatus = () =>
    (calls.statusSets.find((s) => (s as { status?: string }).status) as { status?: string })?.status
  const db: Record<string, unknown> = {
    query: {
      ApprovalRequest: {
        findFirst: async () =>
          opts.reflectClaimAfterCommit && committed
            ? { ...row, status: claimedStatus() ?? row.status }
            : { ...row },
      },
    },
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
  db.transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const result = await fn(db)
    committed = true
    return result
  }
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

  it('an APPROVED access decision writes the security-log row', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db } = makeDb(ACCESS_ROW, { reflectClaimAfterCommit: true })

    await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
      auditContext: { ipAddress: '1.2.3.4', userAgent: 'agent', sessionId: 'sess-1' },
    })

    expect(recordAudit).toHaveBeenCalledTimes(1)
    expect(
      (recordAudit.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]
    ).toMatchObject({
      category: 'security',
      // The SAME action the share popover writes — an approved request is a
      // permission grant, and "how did they get access to X" must be one filter.
      action: 'permission.granted',
      actorId: 'user1',
      targetType: 'Resource',
      targetId: 'thread:thread-1',
      metadata: { origin: 'approval', approvalRequestId: 'req-1', granteeId: 'requester1' },
      context: { ipAddress: '1.2.3.4', userAgent: 'agent', sessionId: 'sess-1' },
    })
  })

  it('a DENIED access decision is logged too, under its own action', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db } = makeDb(ACCESS_ROW, { reflectClaimAfterCommit: true })

    await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'deny',
    })

    // Not `permission.granted` — nothing was granted — but recorded all the same:
    // a decision that appears in the panel and nowhere in the log is
    // indistinguishable from a dropped write.
    expect(
      (recordAudit.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]
    ).toMatchObject({ action: 'accessRequest.denied' })
  })

  it('a WORKFLOW confirmation writes NO security-log row', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db } = makeDb(WORKFLOW_ROW, { reflectClaimAfterCommit: true })

    await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
    })

    // A human-confirmation is a business decision, already recorded on its
    // `WorkflowRun`. The lane gate is what keeps the security category readable.
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it('the LOSER of a race logs nothing', async () => {
    const { resolveApprovalRequest } = await import('../approval-request-mutations')
    const { db } = makeDb(ACCESS_ROW, { claimsAvailable: 1 })

    await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user1',
      action: 'approve',
    })
    recordAudit.mockClear()
    await resolveApprovalRequest(db as never, {
      approvalRequestId: 'req-1',
      userId: 'user2',
      action: 'deny',
    })

    // `decidedKind` is set inside the claim, so only the winner reaches the write.
    // Otherwise every refused double-decision would file a second grant row.
    expect(recordAudit).not.toHaveBeenCalled()
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
