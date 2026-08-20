// packages/lib/src/workflow-engine/nodes/trigger-nodes/manual.test.ts

import { describe, expect, it, vi } from 'vitest'
import { getFormInputOutputVariables } from '../../catalog/nodes/form-input'
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
    // Top-level `nodes` is the shape the engine really publishes — see
    // `WorkflowGraphBuilder.transformNodes`. Asserting against `graph.nodes`
    // here passed while production silently fell back to STRING.
    contextManager.setVariable('sys.workflow', {
      nodes: [
        {
          nodeId: 'form-input-1',
          type: 'form-input',
          data: { inputType: 'boolean', label: 'Confirm' },
        },
      ],
    })

    await run(contextManager)

    expect(await contextManager.getVariable('form-input-1.inputType')).toBe('boolean')
    expect(await contextManager.getVariable('form-input-1.label')).toBe('Confirm')
  })

  /**
   * The SELECT round-trip through the REAL runtime path.
   *
   * A wired form-input is NON_EXECUTABLE, so its own processor never runs and
   * this trigger is what actually publishes the variables. The catalog's
   * `getFormInputOutputVariables` only says what the picker will OFFER — these
   * assert what an execution genuinely writes, which is what `{{...}}` resolves
   * against.
   */
  const selectNode = (multiple: boolean) => ({
    nodeId: 'form-input-1',
    type: 'form-input',
    data: {
      inputType: 'enum',
      label: 'Areas',
      typeOptions: {
        enum: {
          multiple,
          options: [
            { label: 'Billing', value: 'billing' },
            { label: 'Shipping', value: 'shipping' },
          ],
        },
      },
    },
  })

  /** The engine's real shape: nodes at the top level, `graph` holding edges. */
  const selectGraph = (multiple: boolean) => ({
    nodes: [selectNode(multiple)],
    graph: { edges: [] },
  })

  it('writes a scalar `value` for a single SELECT', async () => {
    const contextManager = runContext('user-1')
    contextManager.setVariable('sys.triggerData', { 'form-input-1': 'billing' })
    contextManager.setVariable('sys.workflow', selectGraph(false))

    await run(contextManager)

    expect(await contextManager.getVariable('form-input-1.value')).toBe('billing')
    expect(await contextManager.getVariable('form-input-1.isEmpty')).toBe(false)
  })

  it('writes values/count for a multiple SELECT', async () => {
    const contextManager = runContext('user-1')
    contextManager.setVariable('sys.triggerData', {
      'form-input-1': ['billing', 'shipping'],
    })
    contextManager.setVariable('sys.workflow', selectGraph(true))

    await run(contextManager)

    expect(await contextManager.getVariable('form-input-1.values')).toEqual(['billing', 'shipping'])
    expect(await contextManager.getVariable('form-input-1.count')).toBe(2)
    expect(await contextManager.getVariable('form-input-1.isEmpty')).toBe(false)
  })

  /**
   * The regression behind a real "Expected array but got undefined for
   * itemsSource: …values" failure: `sys.workflow` carries its nodes at the TOP
   * level, but the lookup read `graph.nodes` only, so it returned null on every
   * production run and the STRING fallback published `value` instead of
   * `values`.
   *
   * Pinned to the transformed shape alone — the only one any writer produces.
   */
  it('resolves the form-input config off the transformed workflow', async () => {
    const contextManager = runContext('user-1')
    contextManager.setVariable('sys.triggerData', { 'form-input-1': ['billing'] })
    contextManager.setVariable('sys.workflow', {
      nodes: [selectNode(true)],
      graph: { edges: [] },
    })

    await run(contextManager)

    expect(await contextManager.getVariable('form-input-1.values')).toEqual(['billing'])
    expect(await contextManager.getVariable('form-input-1.inputType')).toBe('enum')
  })

  /**
   * Anti-drift: what the catalog ADVERTISES a node produces must be what an
   * execution actually WRITES. The two live in different files
   * (`getFormInputOutputVariables` vs `setTypedOutputVariables`) and had already
   * drifted twice — a multi SELECT and an ARRAY input each promised
   * `values`/`count` while the engine wrote a scalar `value`, which is what
   * makes a downstream Loop fail with "Expected array but got undefined".
   *
   * Asserting the declared paths are all populated catches the next divergence
   * without anyone having to remember both files exist.
   */
  it.each([
    ['tags', undefined],
    ['array', undefined],
    ['enum', { enum: { multiple: true, options: [{ label: 'A', value: 'a' }] } }],
  ])('writes every variable the catalog advertises for %s', async (inputType, typeOptions) => {
    const data = { inputType, label: 'Areas', typeOptions } as never
    const contextManager = runContext('user-1')
    contextManager.setVariable('sys.triggerData', { 'form-input-1': ['a', 'b'] })
    contextManager.setVariable('sys.workflow', {
      nodes: [{ nodeId: 'form-input-1', type: 'form-input', data }],
      graph: { edges: [] },
    })

    await run(contextManager)

    const declared = getFormInputOutputVariables(data, 'form-input-1')
    expect(declared.length).toBeGreaterThan(0)
    for (const variable of declared) {
      expect(
        await contextManager.getVariable(variable.id),
        `${inputType} declares ${variable.id} but the engine never wrote it`
      ).toBeDefined()
    }
  })

  /**
   * `[]` is what a multi SELECT submits when nothing is picked. It passes every
   * scalar emptiness test, so `isEmpty` reported false until the rule moved to
   * the shared `isEmptyFormInputValue`.
   */
  it('reports isEmpty for a multiple SELECT with nothing picked', async () => {
    const contextManager = runContext('user-1')
    contextManager.setVariable('sys.triggerData', { 'form-input-1': [] })
    contextManager.setVariable('sys.workflow', selectGraph(true))

    await run(contextManager)

    expect(await contextManager.getVariable('form-input-1.values')).toEqual([])
    expect(await contextManager.getVariable('form-input-1.count')).toBe(0)
    expect(await contextManager.getVariable('form-input-1.isEmpty')).toBe(true)
  })
})
