// packages/lib/src/workflow-engine/core/__tests__/approval-resume-variables.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionState } from '../types'
import { WorkflowExecutionStatus } from '../types'

/**
 * The PRODUCTION lane for the human-confirmation node's five decision variables,
 * driven through the real `WorkflowEngine.resumeExecution`.
 *
 * A paused node's processor is never re-entered, so nothing the processor writes
 * can describe a decision that happens later — which is why `approved_by`,
 * `denied_by`, `response_time`, `outcome` and `response_message` used to exist
 * only on the builder's test-run path and resolved to nothing in production,
 * however the decision arrived.
 *
 * The unit-level vocabulary and mapping live in
 * `approval-outcome-vocabulary.test.ts`; this file exists to prove the engine
 * actually applies them, and that the values survive into the run's variables.
 */

const workflowFindFirst = vi.hoisted(() => vi.fn())

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import(
    '../../../test/database-mock'
  )
  return {
    database: new Proxy({} as Record<string, unknown>, {
      get: (_target, prop) => {
        if (prop === 'then') return undefined
        if (prop === 'query') return { Workflow: { findFirst: workflowFindFirst } }
        return createChainableDatabaseMock()
      },
    }),
    db: new Proxy({} as Record<string, unknown>, {
      get: (_target, prop) => {
        if (prop === 'then') return undefined
        if (prop === 'query') return { Workflow: { findFirst: workflowFindFirst } }
        return createChainableDatabaseMock()
      },
    }),
    schema: createSchemaMock({ Workflow: {}, WorkflowNodeExecution: {}, WorkflowRun: {} }),
  }
})
vi.mock('../../../jobs/queues', () => ({
  Queues: {},
  getQueue: () => ({ add: async () => undefined, getJob: async () => null }),
}))

const { WorkflowEngine } = await import('../workflow-engine')

const NODE_ID = 'human_1'
const REQUESTED_AT = '2026-01-01T00:00:00.000Z'

/**
 * A one-node workflow. The human node's outcome branches lead nowhere, so the
 * resume settles immediately after writing the variables — the branch routing
 * itself is pinned in `approval-outcome-vocabulary.test.ts`.
 */
const WORKFLOW = {
  id: 'wf_1',
  organizationId: 'org_1',
  graph: {
    nodes: [
      {
        id: NODE_ID,
        type: 'standard',
        position: { x: 0, y: 0 },
        data: { id: NODE_ID, type: 'human-confirmation', title: 'Human Review' },
      },
    ],
    edges: [],
  },
}

/** The state the run was serialized with while it sat paused on the node. */
function pausedState(): ExecutionState {
  return {
    executionId: 'run_1',
    workflowId: 'wf_1',
    status: WorkflowExecutionStatus.PAUSED,
    currentNodeId: NODE_ID,
    visitedNodes: new Set([NODE_ID]),
    nodeResults: {
      [NODE_ID]: {
        nodeId: NODE_ID,
        status: 'paused',
        output: {
          approval_request_id: 'ar1',
          expires_at: null,
          assignee_count: 1,
          // Written by the processor at pause time — the only carrier of "when
          // we asked", and what makes `response_time` real.
          requested_at: REQUESTED_AT,
        },
        executionTime: 0,
      },
    },
    context: {
      variables: {},
      systemVariables: { 'sys.organizationId': 'org_1', 'sys.userId': 'user_1' },
      nodeVariables: {},
      logs: [],
      executionPath: [],
    },
    startedAt: new Date(REQUESTED_AT),
    pausedAt: new Date(REQUESTED_AT),
    pauseReason: { type: 'human_confirmation', nodeId: NODE_ID, message: 'Approve?' },
  } as unknown as ExecutionState
}

/** Resume the paused run with one producer's payload and read back its variables. */
async function resumeWith(nodeOutput: Record<string, unknown>) {
  const engine = new WorkflowEngine()
  // What `WorkflowExecutionService` awaits before it resumes anything — without
  // it `filterExecutableNodes` drops every node for want of a processor.
  await engine.getNodeRegistry().initializeWithDefaults()
  const result = await engine.resumeExecution(pausedState(), {
    fromNodeId: NODE_ID,
    nodeOutput,
    workflowRunId: 'run_1',
  } as never)
  return result.finalOutput as Record<string, unknown>
}

beforeEach(() => {
  workflowFindFirst.mockReset()
  workflowFindFirst.mockResolvedValue(WORKFLOW)
})

describe('a production resume writes the five decision variables', () => {
  it('on a reviewer APPROVAL', async () => {
    const variables = await resumeWith({
      outcome: 'approved',
      approvalRequestId: 'ar1',
      respondedBy: 'reviewer_1',
      respondedAt: '2026-01-01T00:02:30.000Z',
      comment: 'ship it',
    })

    expect(variables[`${NODE_ID}.outcome`]).toBe('approved')
    expect(variables[`${NODE_ID}.approved_by`]).toBe('reviewer_1')
    expect(variables[`${NODE_ID}.denied_by`]).toBe('')
    expect(variables[`${NODE_ID}.response_message`]).toBe('ship it')
    expect(variables[`${NODE_ID}.response_time`]).toBe(150)
  })

  it('on a reviewer DENIAL', async () => {
    const variables = await resumeWith({
      outcome: 'denied',
      approvalRequestId: 'ar1',
      respondedBy: 'reviewer_1',
      respondedAt: '2026-01-01T00:00:45.000Z',
      comment: 'not yet',
    })

    expect(variables[`${NODE_ID}.outcome`]).toBe('denied')
    expect(variables[`${NODE_ID}.denied_by`]).toBe('reviewer_1')
    expect(variables[`${NODE_ID}.approved_by`]).toBe('')
    expect(variables[`${NODE_ID}.response_time`]).toBe(45)
  })

  it('on a TIMEOUT from the expiry job', async () => {
    const variables = await resumeWith({
      outcome: 'timeout',
      approvalRequestId: 'ar1',
      timedOutAt: '2026-01-01T01:00:00.000Z',
    })

    expect(variables[`${NODE_ID}.outcome`]).toBe('timeout')
    expect(variables[`${NODE_ID}.approved_by`]).toBe('')
    expect(variables[`${NODE_ID}.denied_by`]).toBe('')
    expect(variables[`${NODE_ID}.response_time`]).toBe(3600)
  })

  it('on an administrative CANCEL, naming the canceller as the denier', async () => {
    const variables = await resumeWith({
      outcome: 'denied',
      approvalRequestId: 'ar1',
      cancelledBy: 'admin_1',
      cancelledAt: '2026-01-01T00:05:00.000Z',
      cancelReason: 'workflow retired',
    })

    expect(variables[`${NODE_ID}.outcome`]).toBe('denied')
    expect(variables[`${NODE_ID}.denied_by`]).toBe('admin_1')
    expect(variables[`${NODE_ID}.response_message`]).toBe('workflow retired')
    expect(variables[`${NODE_ID}.response_time`]).toBe(300)
  })

  it("derives response_time from the node's own requested_at, as a real number", async () => {
    const variables = await resumeWith({
      outcome: 'approved',
      respondedBy: 'reviewer_1',
      respondedAt: '2026-01-01T00:10:00.000Z',
    })

    // Not null, not a string, not zero — the paused output's `requested_at` is
    // what a resume payload cannot supply.
    expect(typeof variables[`${NODE_ID}.response_time`]).toBe('number')
    expect(variables[`${NODE_ID}.response_time`]).toBe(600)
  })

  it('writes nothing for a resume that carries no outcome', async () => {
    const variables = await resumeWith({ status: 'completed_from_resume' })

    expect(variables[`${NODE_ID}.outcome`]).toBeUndefined()
    expect(variables[`${NODE_ID}.approved_by`]).toBeUndefined()
  })
})
