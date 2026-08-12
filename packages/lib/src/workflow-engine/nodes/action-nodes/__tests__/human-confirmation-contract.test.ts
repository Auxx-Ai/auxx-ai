// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/human-confirmation-contract.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../../../core/types'
import { NodeRunningStatus } from '../../../core/types'

/**
 * Pins the three builder ↔ engine gaps this node carried:
 *
 * 1. the five reviewer-decision variables the panel advertises
 *    (`approved_by`, `denied_by`, `response_time`, `outcome`, `response_message`)
 *    were never written by the processor,
 * 2. a variable-mode timeout duration — the `{ id }` the panel's VarEditor
 *    writes — reached `Number({…})` and failed every run with "Invalid timeout
 *    duration",
 * 3. `timeout.enabled: false` (the panel's Timeout section switch, which also
 *    removes the node's `timeout` branch) was ignored: the request still got an
 *    `expiresAt` and a delayed timeout job.
 */

const queueAdd = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@auxx/config/server', () => ({ WEBAPP_URL: 'http://localhost:3000' }))
vi.mock('@auxx/database', async () => {
  const { createSchemaMock, createChainableDatabaseMock } = await import(
    '../../../../test/database-mock'
  )
  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock({ ApprovalRequest: {}, WorkflowRun: {} }),
  }
})
vi.mock('../../../../cache/workflow-app-queries', () => ({
  getCachedWorkflowApp: vi.fn(async () => ({ name: 'Human in the loop' })),
}))
vi.mock('../../../../events/publisher', () => ({
  publisher: { publishLater: vi.fn(async () => undefined) },
}))
vi.mock('../../../../jobs/email', () => ({ enqueueEmailJob: vi.fn(async () => undefined) }))
vi.mock('../../../../jobs/queues', () => ({
  Queues: { workflowDelayQueue: 'workflowDelayQueue' },
  getQueue: vi.fn(() => ({ add: queueAdd })),
}))
vi.mock('../../../../approval-requests', () => ({
  generateApprovalTokens: vi.fn(async () => ({})),
}))
vi.mock('../../../../approval-requests/approval-recipients', () => ({
  getApprovalAssigneeUserIds: vi.fn(async () => []),
  approvalEmailEnabledFor: vi.fn(async () => new Set<string>()),
}))
vi.mock('../../../../cache', () => ({ getCachedMembersByUserIds: vi.fn(async () => []) }))

const { HumanConfirmationProcessor } = await import('../human-confirmation')
const { buildApprovalDecisionVariables } = await import('../../../core/pause-resume')

/** Captures the ApprovalRequest insert and swallows the WorkflowRun pause update. */
function makeMockDb() {
  const inserted: any[] = []
  const db: any = {
    insert: () => ({
      values: (v: any) => {
        inserted.push(v)
        return { returning: async () => [{ ...v, id: 'ar1' }] }
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => {
      const builder: any = { from: () => builder, innerJoin: () => builder, where: async () => [] }
      return builder
    },
  }
  return { db, inserted }
}

function makeNode(data: Record<string, unknown>): WorkflowNode {
  return {
    nodeId: 'human_1',
    name: 'Human Review',
    data: {
      type: 'human-confirmation',
      message: 'Ship it?',
      assignees: { actorIds: ['user:u1'] },
      notification_methods: { in_app: false, email: false },
      timeout: { duration: 24, unit: 'hours' },
      require_login: true,
      ...data,
    },
  } as unknown as WorkflowNode
}

function makeContextManager(db: any, debug: boolean, variables: Record<string, unknown> = {}) {
  const written: Record<string, unknown> = {}
  const contextManager = {
    getContext: () => ({
      organizationId: 'org1',
      workflowId: 'wf1',
      executionId: 'run1',
      userId: 'reviewer_1',
      db,
    }),
    getOptions: () => ({ workflowRunId: 'run1', workflowAppId: 'app1' }),
    isDebugMode: () => debug,
    log: vi.fn(),
    getAllVariables: () => ({}),
    getVariable: vi.fn(async (key: string) => variables[key]),
    interpolateVariables: vi.fn(async (t: string) => t),
    setNodeVariable: vi.fn((nodeId: string, path: string, value: unknown) => {
      written[`${nodeId}.${path}`] = value
    }),
    setNodeVariables: vi.fn((nodeId: string, vars: Record<string, unknown>) => {
      for (const [path, value] of Object.entries(vars)) written[`${nodeId}.${path}`] = value
    }),
    serialize: () => ({}),
  }
  return { contextManager: contextManager as any, written }
}

/** `executeNode` is protected; drive it through a subclass. */
class TestHumanConfirmationProcessor extends HumanConfirmationProcessor {
  runNode(...args: Parameters<TestHumanConfirmationProcessor['executeNode']>) {
    return this.executeNode(...args)
  }
  preprocess(...args: Parameters<TestHumanConfirmationProcessor['preprocessNode']>) {
    return this.preprocessNode(...args)
  }
  requiredVariables(node: WorkflowNode) {
    return (this as any).extractRequiredVariables(node) as string[]
  }
}

/**
 * Runs the node WITHOUT preprocessed data, so the timeout is resolved on the
 * execute path exactly as `preprocessNode` would resolve it.
 */
async function run(
  data: Record<string, unknown>,
  options: { debug?: boolean; variables?: Record<string, unknown> } = {}
) {
  const { db, inserted } = makeMockDb()
  const { contextManager, written } = makeContextManager(
    db,
    options.debug ?? false,
    options.variables
  )
  const result = await new TestHumanConfirmationProcessor().runNode(
    makeNode(data),
    contextManager,
    undefined
  )
  return { result, inserted, written }
}

beforeEach(() => {
  queueAdd.mockClear()
})

// ── the five advertised decision variables ───────────────────────────────────

describe('the reviewer-decision variables the panel advertises', () => {
  const ADVERTISED = [
    'approved_by',
    'denied_by',
    'response_time',
    'outcome',
    'response_message',
  ] as const

  it('writes every one of them on an approval', async () => {
    const { written } = await run({ test_behavior: 'always_approve' }, { debug: true })

    for (const path of ADVERTISED) {
      expect(written, `human_1.${path} was never written`).toHaveProperty(`human_1.${path}`)
    }
    expect(written['human_1.outcome']).toBe('approved')
    expect(written['human_1.approved_by']).toBe('reviewer_1')
    // Named, not merely present: a denial must not name the approver.
    expect(written['human_1.denied_by']).toBe('')
  })

  it('writes every one of them on a denial', async () => {
    const { written } = await run({ test_behavior: 'always_deny' }, { debug: true })

    for (const path of ADVERTISED) {
      expect(written).toHaveProperty(`human_1.${path}`)
    }
    expect(written['human_1.outcome']).toBe('denied')
    expect(written['human_1.denied_by']).toBe('reviewer_1')
    expect(written['human_1.approved_by']).toBe('')
  })

  it('writes them on the timeout outcome too, with no responder', async () => {
    const { result, written } = await run({ test_behavior: 'delayed' }, { debug: true })

    expect(result.outputHandle).toBe('timeout')
    expect(written['human_1.outcome']).toBe('timeout')
    expect(written['human_1.approved_by']).toBe('')
    expect(written['human_1.denied_by']).toBe('')
  })

  it('mirrors the variables into the node output for the run trace', async () => {
    const { result } = await run({ test_behavior: 'always_approve' }, { debug: true })
    expect(result.output).toMatchObject({ outcome: 'approved', approved_by: 'reviewer_1' })
  })
})

describe('the paused output feeds the production resume', () => {
  it('records requested_at, which is what makes response_time real', async () => {
    const { result } = await run({ timeout: { duration: 24, unit: 'hours' } })

    // The three producers of a resume payload (reviewer, expiry job,
    // administrative cancel) none of them carry the request time — the node
    // records it, and `WorkflowEngine.resumeExecution` reads it back off this
    // output. Vocabulary and mapping are pinned in
    // `core/__tests__/approval-outcome-vocabulary.test.ts`.
    expect(result.status).toBe(NodeRunningStatus.Paused)
    expect(typeof result.output?.requested_at).toBe('string')
    expect(Number.isNaN(Date.parse(result.output?.requested_at as string))).toBe(false)
  })

  it('turns that stamp into a real response_time', async () => {
    const { result } = await run({ timeout: { duration: 24, unit: 'hours' } })
    const requestedAt = result.output?.requested_at as string

    const vars = buildApprovalDecisionVariables({
      outcome: 'approved',
      respondedBy: 'reviewer_1',
      requestedAt,
      respondedAt: new Date(Date.parse(requestedAt) + 90_000),
    })

    expect(vars.response_time).toBe(90)
    expect(vars.approved_by).toBe('reviewer_1')
  })
})

// ── variable-mode timeout ────────────────────────────────────────────────────

describe('variable-mode timeout duration', () => {
  it("resolves the panel's `{ id }` reference instead of throwing", async () => {
    const { result, inserted } = await run(
      { timeout: { enabled: true, duration: { id: 'trigger_1.sla_hours' }, unit: 'hours' } },
      { variables: { 'trigger_1.sla_hours': 6 } }
    )

    expect(result.status).toBe(NodeRunningStatus.Paused)
    const expiresIn = inserted[0].expiresAt.getTime() - Date.now()
    // 6 hours, within a generous window for test scheduling jitter.
    expect(expiresIn).toBeGreaterThan(5.9 * 60 * 60 * 1000)
    expect(expiresIn).toBeLessThanOrEqual(6 * 60 * 60 * 1000)
  })

  it('resolves a `{{…}}` reference too', async () => {
    const { db } = makeMockDb()
    const { contextManager } = makeContextManager(db, false)
    contextManager.interpolateVariables = vi.fn(async () => '2')
    const result = await new TestHumanConfirmationProcessor().runNode(
      makeNode({ timeout: { duration: { id: '{{trigger_1.sla_days}}' }, unit: 'days' } }),
      contextManager,
      undefined
    )
    expect(result.status).toBe(NodeRunningStatus.Paused)
  })

  it('still fails the node when the reference resolves to nothing', async () => {
    await expect(
      run({ timeout: { duration: { id: 'trigger_1.missing' }, unit: 'hours' } })
    ).rejects.toThrow(/Invalid timeout duration/)
  })

  it('declares the timeout variable as required so it is preloaded', () => {
    const required = new TestHumanConfirmationProcessor().requiredVariables(
      makeNode({ timeout: { duration: { id: 'trigger_1.sla_hours' }, unit: 'hours' } })
    )
    expect(required).toContain('trigger_1.sla_hours')
  })
})

// ── timeout.enabled ──────────────────────────────────────────────────────────

describe('timeout.enabled: false', () => {
  it('creates the request with no expiry and schedules no timeout job', async () => {
    const { result, inserted } = await run({
      timeout: { enabled: false, duration: 24, unit: 'hours' },
    })

    expect(result.status).toBe(NodeRunningStatus.Paused)
    expect(inserted[0].expiresAt).toBeNull()
    expect(queueAdd).not.toHaveBeenCalled()
    expect(result.output?.expires_at).toBeNull()
    expect(result.pauseReason?.metadata?.expiresAt).toBeNull()
  })

  it('still expires — and schedules — when the timeout is on', async () => {
    const { inserted } = await run({ timeout: { enabled: true, duration: 24, unit: 'hours' } })

    expect(inserted[0].expiresAt).toBeInstanceOf(Date)
    expect(queueAdd).toHaveBeenCalledTimes(1)
    expect(queueAdd).toHaveBeenCalledWith(
      'approvalTimeoutJob',
      expect.objectContaining({ approvalRequestId: 'ar1' }),
      expect.objectContaining({ jobId: 'approval-timeout-ar1' })
    )
  })

  it('is honored by preprocessNode as well as by the execute path', async () => {
    const { db } = makeMockDb()
    const { contextManager } = makeContextManager(db, false)
    const preprocessed = await new TestHumanConfirmationProcessor().preprocess(
      makeNode({ timeout: { enabled: false, duration: 24, unit: 'hours' } }),
      contextManager
    )

    expect(preprocessed.inputs.expiresAt).toBeNull()
    expect(preprocessed.metadata?.hasTimeout).toBe(false)
  })

  it('does not require a duration at validation time when it is off', async () => {
    const processor = new TestHumanConfirmationProcessor()
    const disabled = await processor.validate(
      makeNode({ timeout: { enabled: false, unit: 'hours' } })
    )
    const enabled = await processor.validate(makeNode({ timeout: { unit: 'hours' } }))

    expect(disabled.errors).not.toContain('Timeout duration and unit are required')
    expect(enabled.errors).toContain('Timeout duration and unit are required')
  })
})
