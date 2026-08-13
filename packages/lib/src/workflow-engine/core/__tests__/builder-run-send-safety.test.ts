// packages/lib/src/workflow-engine/core/__tests__/builder-run-send-safety.test.ts
//
// A builder run must never put mail in front of a real customer.
//
// The Answer node's `test_behavior: 'default'` dry-runs only when
// `ExecutionContextManager.isDebugMode()` is true, and two builder-initiated paths
// never set that flag:
//
//   1. a single-node "Run" (tRPC `workflow.runSingleNode` → `executeSingleNode`), and
//   2. the second half of a test run, after a Wait/approval pause — `restoreContext`
//      rebuilds the context from the persisted blob, which carries no debug flag.
//
// Both then resolved `'default'` to a REAL send through `MessageSenderService`, with
// `To` auto-resolved off the selected thread — i.e. the actual customer.
//
// Per `plans/workflow/HANDOFF-contract-drift.md`, asserting the call site exists is not
// enough; that exact mistake was made before on this shape of bug. So every case here
// drives the REAL `AnswerProcessor` through the real entry point (`executeSingleNode` /
// `WorkflowEngine.resumeExecution`) and asserts on whether `sendMessage` was reached.
// Each safety assertion is paired with a guard-rail case proving the same drive DOES
// reach `sendMessage` when the run is a production run — otherwise the "never sent"
// assertions could pass vacuously.

import { ParticipantRole } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowTriggerSource } from '../../../workflows/types'
import { WorkflowExecutionService } from '../../../workflows/workflow-execution-service'
import { AnswerProcessor } from '../../nodes/action-nodes/answer'
import { ExecutionContextManager } from '../execution-context'
import type { NodeProcessorRegistry } from '../node-processor-registry'
import { executeSingleNode } from '../single-node-executor'
import { StatePersistenceManager } from '../state-persistence-manager'
import type { ExecutionState, WorkflowNode } from '../types'
import { WorkflowExecutionStatus, WorkflowNodeType } from '../types'
import { WorkflowEngine } from '../workflow-engine'

/** Every real send in these tests funnels through here. */
const sendMessage = vi.fn(async () => ({
  id: 'msg_sent_1',
  threadId: 't_real',
  sendStatus: 'SENT',
}))

// Partial mocks only — a full module replacement drops the other named exports these
// modules provide to the rest of the graph (see the lib test conventions).
vi.mock('../../../messages/message-sender.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../messages/message-sender.service')>()
  return {
    ...actual,
    MessageSenderService: class {
      sendMessage = sendMessage
    },
  }
})

vi.mock('../../../resources/resource-fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../resources/resource-fetcher')>()
  return {
    ...actual,
    // The thread the builder's test picker hydrated the run with — a real org thread,
    // real integration, real customer on it.
    executeResourceQuery: vi.fn(async () => ({
      id: 't_real',
      integrationId: 'int_real',
      subject: 'Where is my order?',
    })),
  }
})

const ORG = 'org_1'
const USER = 'user_1'
const CUSTOMER = 'customer@acme.com'

/**
 * Chainable Drizzle-query mock, branching on the `.select({...})` column keys the way
 * `answer-node.test.ts` does: `metadata` → latest inbound Message, `email` → Integration,
 * `role` → MessageParticipant. (Drizzle table objects are `{}` under vitest, so `.from()`
 * identity is not a usable discriminator.)
 */
function makeMockDb() {
  const select = vi.fn((cols?: Record<string, unknown>) => {
    const keys = cols ? Object.keys(cols) : []
    const resolve = () => {
      if (keys.includes('metadata')) {
        return [{ id: 'm_inbound_1', machineMailTier: null, metadata: null }]
      }
      if (keys.includes('email')) return [{ email: 'support@ourcompany.com' }]
      if (keys.includes('role')) {
        return [{ role: ParticipantRole.FROM, identifier: CUSTOMER }]
      }
      return []
    }
    const builder: any = {
      from: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => resolve(),
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    }
    return builder
  })
  return { select } as any
}

/** Reply into a real thread with auto-resolved recipients — the incident's shape. */
const replyNode = (): WorkflowNode => ({
  id: 'answer_1',
  nodeId: 'answer_1',
  workflowId: 'wf_1',
  name: 'Send Reply',
  type: WorkflowNodeType.ANSWER,
  data: {
    id: 'answer_1',
    type: 'answer',
    title: 'Send Reply',
    messageType: 'reply',
    recordId: 'thread:t_real',
    text: 'Your order shipped yesterday.',
    test_behavior: 'default',
  },
  metadata: {},
})

/**
 * A new-message Answer node. Used for the resume cases because a restored context has no
 * `db` on it (`restoreContext` does not carry one), so the reply path's thread lookups
 * are not reachable there — while `messageType: 'new'` sends with no DB read at all,
 * which is exactly why it was the live hazard after a pause.
 */
const newMessageNodeData = {
  id: 'answer_1',
  type: 'answer',
  title: 'Send Reply',
  messageType: 'new',
  integrationId: 'int_real',
  to: [CUSTOMER],
  toModes: [true],
  subject: 'Your order',
  text: 'Your order shipped yesterday.',
  test_behavior: 'default',
}

beforeEach(() => {
  sendMessage.mockClear()
})

describe('single-node run (builder "Run" button)', () => {
  /** `executeSingleNode` only ever asks the registry for the one processor. */
  const registryWith = (processor: unknown) =>
    ({ getProcessor: async () => processor }) as unknown as NodeProcessorRegistry

  const runSingleNode = () =>
    executeSingleNode(
      replyNode(),
      {},
      {
        workflowId: 'wf_1',
        executionId: 'node-answer_1-123',
        organizationId: ORG,
        userId: USER,
      },
      registryWith(new AnswerProcessor()),
      undefined,
      makeMockDb()
    )

  it('dry-runs an Answer node with test_behavior "default" instead of sending', async () => {
    const result = await runSingleNode()

    expect(sendMessage).not.toHaveBeenCalled()
    expect(result.outputs.dryRun).toBe(true)
    // The run really did resolve the live customer address off the real thread — the
    // dry run is what stopped the mail, not a failure to hydrate.
    expect(result.outputs.to).toEqual([CUSTOMER])
  })

  it('guard-rail: the same node on a production context really sends', async () => {
    // Same processor, same node, same db — only the debug flag differs. Without it this
    // is what the single-node "Run" button did.
    const contextManager = new ExecutionContextManager(
      'wf_1',
      'exec_prod',
      ORG,
      USER,
      undefined,
      undefined,
      undefined,
      undefined,
      makeMockDb()
    )
    contextManager.initializeSystemVariables()

    const result = await new AnswerProcessor().execute(replyNode(), contextManager)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(result.output.dryRun).toBeUndefined()
    expect(result.output.to).toEqual([CUSTOMER])
  })
})

describe('resume after a pause', () => {
  /** wait_1 (paused) → answer_1. */
  const workflowRow = {
    id: 'wf_1',
    organizationId: ORG,
    graph: {
      nodes: [
        { id: 'wait_1', type: 'wait', data: { type: 'wait', title: 'Wait' } },
        { id: 'answer_1', type: 'answer', data: newMessageNodeData },
      ],
      edges: [{ id: 'e1', source: 'wait_1', target: 'answer_1' }],
    },
  }

  /**
   * The persisted state of a run that paused at the Wait node, exactly as
   * `StatePersistenceManager.saveState` + the jsonb column produce it — note it carries
   * NO debug key. That is the point: runs already paused when this fix ships have blobs
   * written without one, so `debug` is re-derived on resume rather than read back.
   */
  const pausedState = (): ExecutionState => {
    const context = {
      variables: { 'sys.organizationId': ORG, 'sys.userId': USER },
      systemVariables: { 'sys.organizationId': ORG, 'sys.userId': USER },
      nodeVariables: {},
      logs: [],
      executionPath: ['wait_1'],
    }
    // Round-trip through JSON the way the jsonb column does.
    const stored = JSON.parse(JSON.stringify(context))
    expect('debug' in stored).toBe(false)

    return {
      executionId: 'run_1',
      workflowId: 'wf_1',
      status: WorkflowExecutionStatus.PAUSED,
      currentNodeId: 'wait_1',
      visitedNodes: new Set(['wait_1']),
      nodeResults: {},
      context: stored,
      startedAt: new Date(),
      pausedAt: new Date(),
      pauseReason: { type: 'wait' as const, nodeId: 'wait_1' },
    }
  }

  const makeEngine = () => {
    const engine = new WorkflowEngine()
    engine.getNodeRegistry().registerProcessor(new AnswerProcessor())
    engine.getNodeRegistry().registerProcessor({
      type: WorkflowNodeType.WAIT,
      preprocessNode: async () => ({ inputs: {}, metadata: {} }),
      execute: async (node: WorkflowNode) => ({
        nodeId: node.nodeId,
        status: 'succeeded' as any,
        output: {},
        executionTime: 0,
      }),
      validate: async () => ({ valid: true, errors: [], warnings: [] }),
    } as any)
    // The only DB read on the resume path; everything else below is real.
    ;(engine as any).loadWorkflow = async () => workflowRow
    return engine
  }

  it('dry-runs the rest of a builder test run, from a blob with no debug flag', async () => {
    const result = await makeEngine().resumeExecution(pausedState(), {
      fromNodeId: 'wait_1',
      debug: true,
    })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(result.nodeResults.answer_1?.output?.dryRun).toBe(true)
    expect(result.nodeResults.answer_1?.output?.to).toEqual([CUSTOMER])
  })

  it('guard-rail: the same resume as a production run really sends', async () => {
    const result = await makeEngine().resumeExecution(pausedState(), {
      fromNodeId: 'wait_1',
    })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(result.nodeResults.answer_1?.output?.dryRun).toBeUndefined()
  })

  // `db` is not serializable, so it is absent from the blob. `restoreContext` used to stop
  // at the 8th constructor arg and leave `context.db` undefined, which made every
  // DB-reading node throw on resume — the Answer node's reply path passes `context.db`
  // straight into `getLatestInboundMessage`. That is why the resume cases above use
  // `messageType: 'new'`: it was the only Answer shape that could actually reach a send
  // after a pause. This asserts the restored context carries a database again, so the
  // reply path is alive rather than silently still broken.
  it('re-attaches a database to the restored context', () => {
    const restored = new StatePersistenceManager().restoreContext(pausedState())

    expect(restored.getContext().db).toBeDefined()
  })
})

describe('WorkflowExecutionService.resumeWorkflow debug derivation', () => {
  /**
   * Drives the real `resumeWorkflow` far enough to capture what it hands the engine.
   * The constructor is bypassed (it dynamically loads and initializes the whole engine);
   * the three private fields it would set are supplied directly.
   */
  const resumeWith = async (triggeredFrom: string) => {
    const captured: { debug?: boolean } = {}
    const db: any = {
      query: {
        WorkflowRun: {
          findFirst: async () => ({
            id: 'run_1',
            workflowId: 'wf_1',
            workflowAppId: 'app_1',
            organizationId: ORG,
            status: 'WAITING',
            triggeredFrom,
            createdBy: USER,
            createdAt: new Date(),
            pausedAt: new Date(),
            serializedState: { variables: {}, systemVariables: {}, visitedNodes: ['wait_1'] },
            workflow: { id: 'wf_1' },
          }),
        },
        SequenceRun: { findFirst: async () => undefined },
      },
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ name: 'Acme', handle: 'acme' }] }) }),
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    }

    const service: any = Object.create(WorkflowExecutionService.prototype)
    service.db = db
    service.initPromise = Promise.resolve()
    service.workflowEngine = {
      resumeExecution: async (_state: ExecutionState, options: { debug?: boolean }) => {
        captured.debug = options.debug
        return {
          status: WorkflowExecutionStatus.COMPLETED,
          nodeResults: {},
          context: { variables: {} },
        }
      },
    }

    await service.resumeWorkflow('run_1', 'wait_1')
    return captured.debug
  }

  it('resumes a DEBUGGING run in debug mode', async () => {
    expect(await resumeWith(WorkflowTriggerSource.DEBUGGING)).toBe(true)
  })

  it('leaves a production run alone', async () => {
    expect(await resumeWith(WorkflowTriggerSource.APP_RUN)).toBe(false)
  })
})
