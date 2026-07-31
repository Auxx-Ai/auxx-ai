// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/human-confirmation-notify.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../../../core/types'

const mocks = vi.hoisted(() => ({
  publishApprovalPing: vi.fn(async () => undefined),
  enqueueEmailJob: vi.fn(async () => undefined),
  sendNotification: vi.fn(async () => ({ id: 'n1' })),
  getApprovalAssigneeUserIds: vi.fn(async () => ['u1']),
  approvalEmailEnabledFor: vi.fn(async () => new Set(['u1'])),
  getCachedMembersByUserIds: vi.fn(async () => [
    { userId: 'u1', user: { email: 'approver@example.com', name: 'Approver' } },
  ]),
}))

vi.mock('@auxx/config/server', () => ({ WEBAPP_URL: 'http://localhost:3000' }))
vi.mock('@auxx/database', async () => {
  const { createSchemaMock, createChainableDatabaseMock } = await import(
    '../../../../test/database-mock'
  )
  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock({
      ApprovalRequest: {},
      WorkflowRun: {},
      User: { id: {}, email: {}, name: {}, userType: {} },
      OrganizationMember: { userId: {}, organizationId: {} },
      EntityGroupMember: { groupInstanceId: {}, memberType: {}, memberRefId: {} },
    }),
  }
})
vi.mock('../../../../cache/workflow-app-queries', () => ({
  getCachedWorkflowApp: vi.fn(async () => ({ name: 'Human in the loop' })),
}))
vi.mock('../../../../events/publisher', () => ({
  publisher: { publishLater: vi.fn(async () => undefined) },
}))
vi.mock('../../../../jobs/email', () => ({ enqueueEmailJob: mocks.enqueueEmailJob }))
vi.mock('../../../../jobs/queues', () => ({
  Queues: { workflowDelayQueue: 'workflowDelayQueue' },
  getQueue: vi.fn(() => ({ add: vi.fn(async () => undefined) })),
}))
vi.mock('../../../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishApprovalPing: mocks.publishApprovalPing,
  publishApprovalResolved: vi.fn(async () => undefined),
}))
vi.mock('../../../../notifications/notification-service', () => ({
  NotificationService: class {
    sendNotification = mocks.sendNotification
  },
}))
// The approval spine moved out of `workflow-engine/services` into the functional
// `approval-requests` module (the two service classes are gone), and the
// per-recipient work was batched: assignee expansion, the email-preference gate
// and token minting are each ONE call for the whole list now.
vi.mock('../../../../approval-requests', () => ({
  generateApprovalTokens: vi.fn(async () => ({ u1: 'tok' })),
}))
vi.mock('../../../../approval-requests/approval-recipients', () => ({
  getApprovalAssigneeUserIds: mocks.getApprovalAssigneeUserIds,
  approvalEmailEnabledFor: mocks.approvalEmailEnabledFor,
}))
vi.mock('../../../../cache', () => ({
  getCachedMembersByUserIds: mocks.getCachedMembersByUserIds,
}))

const { HumanConfirmationProcessor } = await import('../human-confirmation')

const USERS = [{ id: 'u1', email: 'approver@example.com', name: 'Approver' }]

/**
 * The assignee resolution ends in an `innerJoin`; the email fan-out doesn't.
 * That's enough to tell the two selects apart and hand each the right shape.
 */
function makeMockDb() {
  const db: any = {
    insert: () => ({
      values: (value: any) => ({ returning: async () => [{ ...value, id: 'ar1' }] }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => {
      let joined = false
      const builder: any = {
        from: () => builder,
        innerJoin: () => {
          joined = true
          return builder
        },
        where: async () => (joined ? USERS.map((user) => ({ id: user.id })) : USERS),
      }
      return builder
    },
  }
  return db
}

function makeNode(methods: { in_app: boolean; email: boolean }): WorkflowNode {
  return {
    nodeId: 'human-confirmation-1',
    name: 'Human Review',
    data: {
      type: 'human-confirmation',
      message: 'Ship it?',
      assignees: { actorIds: ['user:u1'] },
      notification_methods: methods,
      timeout: { duration: 24, unit: 'hours' },
      require_login: true,
    },
  } as unknown as WorkflowNode
}

function makeContextManager(db: any) {
  return {
    getContext: () => ({
      organizationId: 'org1',
      workflowId: 'wf1',
      executionId: 'run1',
      userId: 'u1',
      db,
    }),
    getOptions: () => ({ workflowRunId: 'run1', workflowAppId: 'app1' }),
    isDebugMode: () => false,
    log: vi.fn(),
    getAllVariables: () => ({}),
    serialize: () => ({}),
  } as any
}

const preprocessed = {
  inputs: {
    message: 'Ship it?',
    assignees: { userIds: ['u1'], groups: [] },
    expiresAt: new Date(Date.now() + 86_400_000),
  },
  metadata: {},
} as any

/** `executeNode` is protected on the processor; drive it through a subclass. */
class TestHumanConfirmationProcessor extends HumanConfirmationProcessor {
  runNode(...args: Parameters<TestHumanConfirmationProcessor['executeNode']>) {
    return this.executeNode(...args)
  }
}

const run = (methods: { in_app: boolean; email: boolean }) =>
  new TestHumanConfirmationProcessor().runNode(
    makeNode(methods),
    makeContextManager(makeMockDb()),
    preprocessed
  )

describe('HumanConfirmationProcessor assignee notification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getApprovalAssigneeUserIds.mockResolvedValue(['u1'])
    mocks.approvalEmailEnabledFor.mockResolvedValue(new Set(['u1']))
    mocks.getCachedMembersByUserIds.mockResolvedValue([
      { userId: 'u1', user: { email: 'approver@example.com', name: 'Approver' } },
    ])
  })

  it('pings assignees over realtime and mints NO notification row', async () => {
    await run({ in_app: true, email: false })

    expect(mocks.publishApprovalPing).toHaveBeenCalledTimes(1)
    expect(mocks.publishApprovalPing).toHaveBeenCalledWith(
      expect.anything(),
      ['u1'],
      expect.objectContaining({ approvalRequestId: 'ar1', organizationId: 'org1' })
    )
    // The bell counts `unread notifications + pending approvals`. A row for a
    // still-pending request would make one approval read as 2.
    expect(mocks.sendNotification).not.toHaveBeenCalled()
  })

  it('sends no live ping when in_app is off', async () => {
    await run({ in_app: false, email: false })
    expect(mocks.publishApprovalPing).not.toHaveBeenCalled()
    expect(mocks.sendNotification).not.toHaveBeenCalled()
  })

  it('emails the assignee when the node and the recipient both allow it', async () => {
    await run({ in_app: false, email: true })
    expect(mocks.enqueueEmailJob).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueEmailJob).toHaveBeenCalledWith(
      'approval-request',
      expect.objectContaining({ recipient: { email: 'approver@example.com', name: 'Approver' } })
    )
  })

  it('skips a recipient the batched email-preference gate excluded', async () => {
    // The per-recipient `approvalEmailEnabled` lookup became one batched
    // `approvalEmailEnabledFor` call returning the ALLOWED set; a user missing
    // from it is a user who turned `notification.approval.email` off.
    mocks.approvalEmailEnabledFor.mockResolvedValue(new Set())
    await run({ in_app: false, email: true })
    expect(mocks.enqueueEmailJob).not.toHaveBeenCalled()
  })

  it('asks the preference gate about exactly the resolved assignees', async () => {
    mocks.getApprovalAssigneeUserIds.mockResolvedValue(['u1', 'u2'])
    await run({ in_app: false, email: true })
    expect(mocks.approvalEmailEnabledFor).toHaveBeenCalledWith(expect.anything(), 'org1', [
      'u1',
      'u2',
    ])
    // `u2` is not in the allowed set, so only `u1` is mailed.
    expect(mocks.enqueueEmailJob).toHaveBeenCalledTimes(1)
  })
})
