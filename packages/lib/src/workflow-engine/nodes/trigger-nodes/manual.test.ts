// packages/lib/src/workflow-engine/nodes/trigger-nodes/manual.test.ts

import { describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../../core/execution-context'
import type { WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { ManualTriggerProcessor } from './manual'

// Silence the logger. Partial mock: `@auxx/logger/run-log` imports sink-registration
// helpers from this barrel at module load, so a full replacement breaks collection.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const TRIGGER_NODE_ID = 'trigger-001'

/** A manual-trigger node in the shape `WorkflowGraphBuilder.transformNodes` emits. */
const manualNode = (): WorkflowNode => ({
  id: 'node-1',
  workflowId: 'workflow-1',
  nodeId: TRIGGER_NODE_ID,
  type: WorkflowNodeType.MANUAL,
  name: 'Manual Trigger',
  data: {
    id: 'node-1',
    type: WorkflowNodeType.MANUAL,
    title: 'Manual Trigger',
  } as WorkflowNode['data'],
})

function runContext(userId?: string) {
  return new ExecutionContextManager('workflow-1', 'exec-1', 'org-1', userId)
}

async function run(contextManager: ExecutionContextManager) {
  const processor = new ManualTriggerProcessor()
  return (processor as any).executeNode(manualNode(), contextManager)
}

describe('ManualTriggerProcessor', () => {
  it('publishes the three variables the builder advertises', async () => {
    const contextManager = runContext('user-1')
    contextManager.setVariable('sys.triggerData', { 'form-input-1': 'hello' })

    const before = Date.now()
    const result = await run(contextManager)

    expect(result.status).toBe(NodeRunningStatus.Succeeded)

    const timestamp = await contextManager.getVariable(`${TRIGGER_NODE_ID}.timestamp`)
    expect(typeof timestamp).toBe('string')
    expect(Date.parse(timestamp)).toBeGreaterThanOrEqual(before)
    // The trace row and the variable name the same instant.
    expect(result.output.triggered_at).toBe(timestamp)

    expect(await contextManager.getVariable(`${TRIGGER_NODE_ID}.userId`)).toBe('user-1')
    expect(await contextManager.getVariable(`${TRIGGER_NODE_ID}.inputs`)).toEqual({
      'form-input-1': 'hello',
    })
  })

  it('takes userId from the run context, not the trigger payload', async () => {
    // A run started from the builder carries the signed-in user; a headless run
    // carries the org system user. Either way it is the context's, and a
    // same-named key in the payload must not be able to spoof it.
    const contextManager = runContext('acting-user')
    contextManager.setVariable('sys.triggerData', { userId: 'payload-user' })

    await run(contextManager)

    expect(await contextManager.getVariable(`${TRIGGER_NODE_ID}.userId`)).toBe('acting-user')
  })

  it('publishes an empty userId rather than undefined when the run has no acting user', async () => {
    const contextManager = runContext(undefined)
    contextManager.setVariable('sys.triggerData', {})

    await run(contextManager)

    expect(await contextManager.getVariable(`${TRIGGER_NODE_ID}.userId`)).toBe('')
  })

  it('still publishes the trigger variables when the run has no inputs at all', async () => {
    const contextManager = runContext('user-1')

    await run(contextManager)

    expect(await contextManager.getVariable(`${TRIGGER_NODE_ID}.inputs`)).toEqual({})
    expect(await contextManager.getVariable(`${TRIGGER_NODE_ID}.userId`)).toBe('user-1')
    expect(await contextManager.getVariable(`${TRIGGER_NODE_ID}.timestamp`)).toBeDefined()
  })

  it('publishes each form input under its own node id alongside the trigger variables', async () => {
    const contextManager = runContext('user-1')
    contextManager.setVariable('sys.triggerData', { 'form-input-1': 'hello' })

    await run(contextManager)

    // The bare key backs `{{form-input-1}}`, `.value` is what the picker emits.
    expect(await contextManager.getVariable('form-input-1')).toBe('hello')
    expect(await contextManager.getVariable('form-input-1.value')).toBe('hello')
    // The unaddressable `manualInputs` global is gone; `<trigger>.inputs` replaces it.
    expect(await contextManager.getVariable('manualInputs')).toBeUndefined()
  })

  it('types a form input from the connected form-input node in the graph', async () => {
    const contextManager = runContext('user-1')
    contextManager.setVariable('sys.triggerData', { 'form-input-1': 'true' })
    // `inputType` / `typeOptions` are read off the FORM-INPUT node's data, which
    // its own panel writes — the manual trigger's data carries neither.
    contextManager.setVariable('sys.workflow', {
      graph: {
        nodes: [
          {
            nodeId: 'form-input-1',
            type: 'form-input',
            data: { inputType: 'boolean', label: 'Confirm' },
          },
        ],
      },
    })

    await run(contextManager)

    expect(await contextManager.getVariable('form-input-1.inputType')).toBe('boolean')
    expect(await contextManager.getVariable('form-input-1.label')).toBe('Confirm')
  })
})
