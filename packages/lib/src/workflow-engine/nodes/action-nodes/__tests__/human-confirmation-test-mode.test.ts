// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/human-confirmation-test-mode.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../../../core/types'
import { NodeRunningStatus } from '../../../core/types'

vi.mock('@auxx/config/server', () => ({ WEBAPP_URL: 'http://localhost:3000' }))
vi.mock('@auxx/database', () => ({
  database: {},
  schema: {
    ApprovalRequest: {},
    WorkflowRun: {},
    User: { id: {}, email: {}, name: {}, userType: {} },
    OrganizationMember: { userId: {}, organizationId: {} },
  },
}))
vi.mock('../../../../cache/workflow-app-queries', () => ({
  getCachedWorkflowApp: vi.fn(async () => ({ name: 'Human in the loop' })),
}))
vi.mock('../../../../events/publisher', () => ({
  publisher: { publishLater: vi.fn(async () => undefined) },
}))
vi.mock('../../../../jobs/email', () => ({ enqueueEmailJob: vi.fn(async () => undefined) }))
vi.mock('../../../../jobs/queues', () => ({
  Queues: { workflowDelayQueue: 'workflowDelayQueue' },
  getQueue: vi.fn(() => ({ add: vi.fn(async () => undefined) })),
}))
vi.mock('../../../../notifications/notification-service', () => ({
  NotificationService: class {
    sendNotification = vi.fn(async () => ({ id: 'n1' }))
  },
}))
vi.mock('../../../services/approval-response-service', () => ({
  ApprovalResponseService: class {
    generateApprovalToken = vi.fn(async () => 'tok')
  },
}))

const { HumanConfirmationProcessor } = await import('../human-confirmation')

/** Captures the ApprovalRequest insert and swallows the WorkflowRun pause update. */
function makeMockDb() {
  const inserted: any[] = []
  const db: any = {
    insert: () => ({
      values: (v: any) => {
        inserted.push(v)
        return { returning: async () => [{ ...v, expiresAt: v.expiresAt }] }
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => {
      const builder: any = {
        from: () => builder,
        where: async () => [],
      }
      return builder
    },
  }
  return { db, inserted }
}

function makeNode(testBehavior?: string): WorkflowNode {
  return {
    nodeId: 'human-confirmation-1',
    name: 'Human Review',
    data: {
      type: 'human-confirmation',
      message: 'Do you like the name?',
      assignees: { actorIds: ['user:u1'] },
      notification_methods: { in_app: false, email: false },
      timeout: { duration: 24, unit: 'hours' },
      require_login: true,
      ...(testBehavior ? { test_behavior: testBehavior } : {}),
    },
  } as unknown as WorkflowNode
}

function makeContextManager(db: any, debug: boolean) {
  return {
    getContext: () => ({
      organizationId: 'org1',
      workflowId: 'wf1',
      executionId: 'run1',
      userId: 'u1',
      db,
    }),
    getOptions: () => ({ workflowRunId: 'run1', workflowAppId: 'app1' }),
    isDebugMode: () => debug,
    log: vi.fn(),
    getAllVariables: () => ({}),
    serialize: () => ({}),
  } as any
}

const preprocessed = {
  inputs: {
    message: 'Do you like the name?',
    assignees: { userIds: ['u1'], groups: [] },
    expiresAt: new Date(Date.now() + 86_400_000),
  },
  metadata: {},
} as any

describe('HumanConfirmationProcessor test-mode gating', () => {
  let processor: any

  beforeEach(() => {
    processor = new HumanConfirmationProcessor()
  })

  const run = (testBehavior: string | undefined, debug: boolean) => {
    const { db, inserted } = makeMockDb()
    const node = makeNode(testBehavior)
    return processor
      .executeNode(node, makeContextManager(db, debug), preprocessed)
      .then((result: any) => ({ result, inserted }))
  }

  it('does NOT auto-approve a production run carrying the default always_approve setting', async () => {
    const { result, inserted } = await run('always_approve', false)
    expect(result.output?.test_mode).toBeUndefined()
    expect(result.status).toBe(NodeRunningStatus.Paused)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].status).toBe('pending')
  })

  it('creates a real approval request in production when no test_behavior is set', async () => {
    const { result, inserted } = await run(undefined, false)
    expect(result.status).toBe(NodeRunningStatus.Paused)
    expect(inserted).toHaveLength(1)
  })

  it('auto-approves a builder test run with always_approve', async () => {
    const { result, inserted } = await run('always_approve', true)
    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    expect(result.outputHandle).toBe('approved')
    expect(result.output?.test_mode).toBe(true)
    expect(inserted).toHaveLength(0)
  })

  it('auto-denies a builder test run with always_deny', async () => {
    const { result } = await run('always_deny', true)
    expect(result.outputHandle).toBe('denied')
  })

  it('takes the real approval path on a test run when test_behavior is live', async () => {
    const { result, inserted } = await run('live', true)
    expect(result.status).toBe(NodeRunningStatus.Paused)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].metadata?.isTestMode).toBe(true)
  })

  it('does not flag a production approval request as test data', async () => {
    const { inserted } = await run('live', false)
    expect(inserted[0].metadata?.isTestMode).toBeUndefined()
  })
})
