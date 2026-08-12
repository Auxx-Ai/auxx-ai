// packages/lib/src/workflow-engine/nodes/__tests__/app-workflow-block-processor.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { WorkflowNode } from '../../core/types'
import {
  AppWorkflowBlockProcessor,
  type FieldDefinition,
  type WorkflowBlockMetadata,
} from '../app-workflow-block-processor'
import { isAppInputField, PLATFORM_NODE_DATA_KEYS } from '../utils/app-input-fields'

// Keep the real installation resolver (and its @auxx/database import) out of the graph.
vi.mock('../../../apps/installations/resolve-active-installation', () => ({
  resolveActiveInstallationId: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: 'install_resolved',
  })),
}))

/** Minimal permissive metadata — mirrors what `fetchBlockMetadata` actually returns today. */
function makeMetadata(inputs: Record<string, FieldDefinition> = {}): WorkflowBlockMetadata {
  return {
    id: 'shopify',
    label: 'Shopify: Get Order',
    description: 'Look up an order',
    category: 'integration',
    schema: { inputs, outputs: {} },
  }
}

function makeProcessor(inputs: Record<string, FieldDefinition> = {}) {
  return new AppWorkflowBlockProcessor('@shopify', 'shopify', makeMetadata(inputs))
}

function makeContextManager(variables: Record<string, unknown> = {}) {
  return {
    getContext: () => ({
      organizationId: 'org_1',
      workflowId: 'wf_1',
      executionId: 'exec_1',
      userId: 'user_1',
    }),
    getVariable: vi.fn(async (path: string) => variables[path]),
    interpolateVariables: vi.fn(async (template: string) =>
      template.replace(/\{\{([^}]+)\}\}/g, (_m, p: string) => String(variables[p.trim()] ?? ''))
    ),
    getAllVariables: () => variables,
    getEnvironmentVariables: () => ({}),
    getSystemVariables: () => ({}),
    getTriggerData: () => ({}),
    getAllNodeVariables: () => ({}),
    setNodeVariable: vi.fn(),
  } as unknown as ExecutionContextManager
}

/**
 * The real on-disk shape of the shipped Shopify app block.
 * Source: packages/lib/src/workflows/templates/shopify-order-lookup.template.json
 */
function shopifyNodeData(): Record<string, unknown> {
  return {
    id: 'shopify_get_order',
    type: '@shopify:shopify',
    appSlug: 'shopify',
    blockId: 'shopify',
    title: 'Shopify: Get Order',
    desc: "Look up the customer's order in Shopify",
    resource: 'order',
    operation: 'get',
    getOrderId: '{{extractor_1.extracted_data.order_number}}',
    getFields: [],
    fieldModes: { getOrderId: false },
    _connectedSourceHandleIds: ['source'],
    _connectedTargetHandleIds: ['target'],
  }
}

function makeNode(data: Record<string, unknown>): WorkflowNode {
  return { nodeId: 'shopify_get_order', type: '@shopify:shopify', data } as unknown as WorkflowNode
}

/** Exposes the protected variable extractor for the parity assertions. */
function extractVariables(processor: AppWorkflowBlockProcessor, node: WorkflowNode): string[] {
  return (
    processor as unknown as { extractRequiredVariables(n: WorkflowNode): string[] }
  ).extractRequiredVariables(node)
}

describe('isAppInputField', () => {
  it('excludes builder-owned identity keys', () => {
    expect(isAppInputField('id')).toBe(false)
    expect(isAppInputField('appSlug')).toBe(false)
    expect(isAppInputField('appId')).toBe(false)
    expect(isAppInputField('blockId')).toBe(false)
    expect(isAppInputField('type')).toBe(false)
    expect(isAppInputField('installationId')).toBe(false)
    expect(isAppInputField('connectionId')).toBe(false)
    expect(isAppInputField('triggerId')).toBe(false)
  })

  it('excludes builder presentation and bookkeeping keys', () => {
    for (const key of [
      'title',
      'desc',
      'description',
      'name',
      'icon',
      'color',
      'fieldModes',
      'config',
      'triggerFilters',
      'isValid',
      'errors',
      'disabled',
      'selected',
      'collapsed',
      'width',
      'height',
      'isInLoop',
      'loopId',
      'inputNodes',
      'inferredSchema',
      'outputVariables',
      'errorStrategy',
      'retryConfig',
    ]) {
      expect(isAppInputField(key), `${key} must not be an app input`).toBe(false)
    }
  })

  it('excludes every key in PLATFORM_NODE_DATA_KEYS', () => {
    for (const key of PLATFORM_NODE_DATA_KEYS) {
      expect(isAppInputField(key), `${key} must not be an app input`).toBe(false)
    }
  })

  it('excludes ephemeral underscore-prefixed UI state', () => {
    expect(isAppInputField('_connectedSourceHandleIds')).toBe(false)
    expect(isAppInputField('_computedOutputs')).toBe(false)
    expect(isAppInputField('_hiddenFields')).toBe(false)
  })

  it('includes genuine app input fields', () => {
    expect(isAppInputField('resource')).toBe(true)
    expect(isAppInputField('operation')).toBe(true)
    expect(isAppInputField('getOrderId')).toBe(true)
    expect(isAppInputField('getFields')).toBe(true)
    expect(isAppInputField('channel')).toBe(true)
    expect(isAppInputField('message')).toBe(true)
  })

  it('treats a non-empty schema as an authoritative allowlist', () => {
    const schema: Record<string, FieldDefinition> = {
      getOrderId: { type: 'string', label: 'Order ID' },
    }
    expect(isAppInputField('getOrderId', schema)).toBe(true)
    // Declared by the app, so it is an input even though the name collides with a builder key
    expect(isAppInputField('resource', schema)).toBe(false)
    // Underscore keys stay excluded regardless of the schema
    expect(isAppInputField('_computedOutputs', schema)).toBe(false)
  })

  it('falls back to the denylist when the schema is empty', () => {
    expect(isAppInputField('resource', {})).toBe(true)
    expect(isAppInputField('id', {})).toBe(false)
  })

  it('does not treat inherited Object.prototype keys as declared inputs', () => {
    const schema: Record<string, FieldDefinition> = {
      getOrderId: { type: 'string', label: 'Order ID' },
    }
    expect(isAppInputField('toString', schema)).toBe(false)
    expect(isAppInputField('constructor', schema)).toBe(false)
  })
})

describe('AppWorkflowBlockProcessor.preprocessNode input filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not forward internal builder keys to the app', async () => {
    const processor = makeProcessor()
    const contextManager = makeContextManager({
      'extractor_1.extracted_data.order_number': '1234',
    })

    const result = await processor.preprocessNode(makeNode(shopifyNodeData()), contextManager)

    expect(result.inputs).not.toHaveProperty('id')
    expect(result.inputs).not.toHaveProperty('appSlug')
    expect(result.inputs).not.toHaveProperty('type')
    expect(result.inputs).not.toHaveProperty('blockId')
    expect(result.inputs).not.toHaveProperty('title')
    expect(result.inputs).not.toHaveProperty('desc')
    expect(result.inputs).not.toHaveProperty('fieldModes')
    expect(result.inputs).not.toHaveProperty('_connectedSourceHandleIds')
  })

  it('forwards exactly the genuine app inputs for the shipped Shopify node', async () => {
    const processor = makeProcessor()
    const contextManager = makeContextManager({
      'extractor_1.extracted_data.order_number': '1234',
    })

    const result = await processor.preprocessNode(makeNode(shopifyNodeData()), contextManager)

    expect(Object.keys(result.inputs).sort()).toEqual([
      'getFields',
      'getOrderId',
      'operation',
      'resource',
    ])
    expect(result.inputs.resource).toBe('order')
    expect(result.inputs.operation).toBe('get')
    // getOrderId is in variable mode, so it is resolved rather than passed through
    expect(result.inputs.getOrderId).toBe('1234')
  })

  it('drops builder keys a canvas-created node accumulates', async () => {
    const processor = makeProcessor()
    const data = {
      ...shopifyNodeData(),
      isValid: true,
      errors: [],
      disabled: false,
      isInLoop: false,
      loopId: undefined,
      selected: false,
      collapsed: false,
      width: 240,
      height: 120,
      inferredSchema: { foo: 'bar' },
      connectionId: 'conn_1',
      config: { polling: { intervalMinutes: 5 } },
    }

    const result = await processor.preprocessNode(makeNode(data), makeContextManager())

    expect(Object.keys(result.inputs).sort()).toEqual([
      'getFields',
      'getOrderId',
      'operation',
      'resource',
    ])
  })

  it('honours a declared schema as an allowlist', async () => {
    const processor = makeProcessor({ getOrderId: { type: 'string', label: 'Order ID' } })

    const result = await processor.preprocessNode(
      makeNode(shopifyNodeData()),
      makeContextManager({ 'extractor_1.extracted_data.order_number': '1234' })
    )

    expect(Object.keys(result.inputs)).toEqual(['getOrderId'])
  })
})

describe('preprocessNode and extractRequiredVariables agree on the same node data', () => {
  /**
   * Every app input is a distinct plain variable path in variable mode, and the builder keys
   * carry variable-looking values too. The set of paths the extractor declares must therefore
   * be exactly the set of values preprocessNode resolves — nothing more, nothing less.
   */
  const parityData: Record<string, unknown> = {
    // builder-owned, all variable-looking
    id: 'internal.id',
    type: '@shopify:shopify',
    appSlug: 'internal.appSlug',
    appId: 'internal.appId',
    blockId: 'internal.blockId',
    title: 'internal.title',
    desc: 'internal.desc',
    connectionId: 'internal.connectionId',
    inferredSchema: 'internal.inferredSchema',
    _computedOutputs: 'internal.computedOutputs',
    // genuine app inputs, all in variable mode
    resource: 'trigger_1.resource',
    operation: 'trigger_1.operation',
    getOrderId: 'extractor_1.order_number',
    fieldModes: { resource: false, operation: false, getOrderId: false },
  }

  const appFieldNames = ['getOrderId', 'operation', 'resource']

  it('agrees with an empty schema (the production path)', async () => {
    const processor = makeProcessor()
    const node = makeNode(parityData)

    const { inputs } = await processor.preprocessNode(node, makeContextManager())
    const variables = extractVariables(processor, node)

    expect(Object.keys(inputs).sort()).toEqual(appFieldNames)
    expect(variables.sort()).toEqual(appFieldNames.map((f) => parityData[f] as string).sort())
  })

  it('agrees with a declared schema', async () => {
    const processor = makeProcessor({
      resource: { type: 'string', label: 'Resource' },
      getOrderId: { type: 'string', label: 'Order ID' },
    })
    const node = makeNode(parityData)

    const { inputs } = await processor.preprocessNode(node, makeContextManager())
    const variables = extractVariables(processor, node)

    expect(Object.keys(inputs).sort()).toEqual(['getOrderId', 'resource'])
    expect(variables.sort()).toEqual(['extractor_1.order_number', 'trigger_1.resource'])
  })

  it('declares required variables when the schema is empty (regression)', () => {
    // The old allowlist-only extractor returned [] for every app block, because
    // blockMetadata.schema.inputs is always empty in production.
    const processor = makeProcessor()
    const node = makeNode({
      ...shopifyNodeData(),
      fieldModes: { getOrderId: false },
    })

    expect(extractVariables(processor, node)).toEqual(['extractor_1.extracted_data.order_number'])
  })

  it('never declares a builder key as a required variable', () => {
    const processor = makeProcessor()
    const node = makeNode({
      ...parityData,
      // force every key into variable mode, including the builder-owned ones
      fieldModes: Object.fromEntries(Object.keys(parityData).map((k) => [k, false])),
    })

    const variables = extractVariables(processor, node)

    for (const v of variables) {
      expect(v.startsWith('internal.'), `${v} is a builder-owned value`).toBe(false)
    }
  })
})
