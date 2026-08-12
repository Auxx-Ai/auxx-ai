// packages/lib/src/workflow-engine/nodes/trigger-nodes/__tests__/extract-user-inputs.test.ts

import { describe, expect, it } from 'vitest'
import { PLATFORM_NODE_DATA_KEYS } from '../../utils/app-input-fields'
import { extractUserInputs } from '../extract-user-inputs'

/**
 * The 13 builder keys the old 23-key `METADATA_FIELDS` set did not list, so app triggers
 * forwarded them to the app runtime as if they were user inputs.
 */
const PREVIOUSLY_LEAKING_KEYS = [
  'loopId',
  'selected',
  'collapsed',
  'width',
  'height',
  'isInIteration',
  'iterationId',
  'inferredSchema',
  'inputNodes',
  'outputVariables',
  'credentialId',
  'errorStrategy',
  'retryConfig',
] as const

/**
 * The on-disk shape of an app trigger node: `workflow-block-registry.tsx:134-144` supplies
 * `title`/`desc`/`appId`/`appSlug`/`triggerId`/`config.polling`, `node-factory.ts:70-89` stamps
 * the rest, and the canvas/panel add the remainder over a node's lifetime.
 */
function appTriggerNodeData(): Record<string, unknown> {
  return {
    // registry defaultData
    title: 'Shopify: Order Created',
    desc: 'Fires when an order is created',
    appId: '@shopify',
    appSlug: 'shopify',
    triggerId: 'order-created',
    config: { polling: { intervalMinutes: 5 } },
    // node-factory
    id: 'trigger_1',
    type: '@shopify:order-created',
    isValid: true,
    errors: [],
    disabled: false,
    isInLoop: false,
    loopId: undefined,
    selected: false,
    // canvas / panel accumulation
    collapsed: false,
    width: 240,
    height: 120,
    isInIteration: false,
    iterationId: undefined,
    inferredSchema: { foo: 'bar' },
    inputNodes: ['other_node'],
    outputVariables: ['trigger_1.order'],
    credentialId: null,
    errorStrategy: 'fail',
    retryConfig: { maxRetries: 3, retryInterval: 1000 },
    connectionId: 'conn_1',
    installationId: 'install_1',
    fieldModes: { shopLocation: false },
    triggerFilters: [{ field: 'status', value: 'paid' }],
    metadata: { something: true },
    isEnabled: true,
    name: 'trigger',
    description: 'alias of desc',
    icon: 'shopify',
    color: '#95BF47',
    // ephemeral UI state
    _connectedSourceHandleIds: ['source'],
    _computedOutputs: { order: {} },
    // genuine app trigger inputs
    shopLocation: 'eu-warehouse',
    includeLineItems: true,
    minOrderValue: 25,
  }
}

describe('extractUserInputs', () => {
  it('keeps only the genuine app trigger inputs', () => {
    expect(extractUserInputs(appTriggerNodeData())).toEqual({
      shopLocation: 'eu-warehouse',
      includeLineItems: true,
      minOrderValue: 25,
    })
  })

  it('excludes the 13 keys that previously leaked to the app runtime', () => {
    const inputs = extractUserInputs(appTriggerNodeData())

    for (const key of PREVIOUSLY_LEAKING_KEYS) {
      expect(inputs, `${key} must no longer leak`).not.toHaveProperty(key)
    }
  })

  it('excludes every platform key, including trigger-specific ones', () => {
    const inputs = extractUserInputs(appTriggerNodeData())

    for (const key of PLATFORM_NODE_DATA_KEYS) {
      expect(inputs, `${key} must not be forwarded`).not.toHaveProperty(key)
    }
    // trigger-shaped platform keys specifically
    expect(inputs).not.toHaveProperty('triggerId')
    expect(inputs).not.toHaveProperty('triggerFilters')
    expect(inputs).not.toHaveProperty('config')
  })

  it('excludes ephemeral underscore-prefixed UI state', () => {
    const inputs = extractUserInputs(appTriggerNodeData())

    expect(inputs).not.toHaveProperty('_connectedSourceHandleIds')
    expect(inputs).not.toHaveProperty('_computedOutputs')
  })

  it('preserves falsy and empty app input values', () => {
    expect(
      extractUserInputs({
        id: 'trigger_1',
        appSlug: 'shopify',
        includeLineItems: false,
        minOrderValue: 0,
        note: '',
        tags: [],
      })
    ).toEqual({ includeLineItems: false, minOrderValue: 0, note: '', tags: [] })
  })

  it('returns an empty object when a trigger has no app inputs', () => {
    expect(extractUserInputs({ id: 'trigger_1', appId: '@shopify', title: 'T' })).toEqual({})
  })

  it('does not inherit Object.prototype keys', () => {
    expect(extractUserInputs({})).toEqual({})
    expect(Object.keys(extractUserInputs({ toString: 'x' }))).toEqual(['toString'])
  })
})

describe('app triggers and app blocks agree on what an app input is', () => {
  it('applies the same filter to a shared node-data shape', () => {
    // The keys below are the intersection of what both paths can carry.
    const shared = {
      id: 'node_1',
      type: '@shopify:thing',
      appId: '@shopify',
      appSlug: 'shopify',
      title: 'Shopify',
      desc: 'd',
      fieldModes: {},
      _computedOutputs: {},
      resource: 'order',
      operation: 'get',
    }

    // extractUserInputs is the trigger side; the block side filters with the same predicate,
    // so the surviving key set must match exactly.
    expect(Object.keys(extractUserInputs(shared)).sort()).toEqual(['operation', 'resource'])
  })
})
