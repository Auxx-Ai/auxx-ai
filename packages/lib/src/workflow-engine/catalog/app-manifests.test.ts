// packages/lib/src/workflow-engine/catalog/app-manifests.test.ts
// Server-side app-block output resolution. Pure over catalog shapes — the org
// cache read (`buildAppBlockLookup`) is covered by resolve-outputs.test.ts,
// which exercises it through the graph walk.
//
// See plans/kopilot/workflow/17-app-block-authoring-and-connections.md §4 A3.

import { describe, expect, it } from 'vitest'
import type { CachedBlockOp, CachedWorkflowBlock } from '../../cache/org-cache-keys'
import {
  fieldNodeMapToUnifiedVariables,
  resolveAppBlockOutputs,
  schemaPropertiesToUnifiedVariables,
} from './app-manifests'

const NODE = 'fedex-DmJuCD8M2cAE0Hqdua0Ns'

/** The real shape `fedex_block_track` publishes, trimmed to three fields. */
const trackOutputs = {
  type: 'object',
  required: ['trackingNumber', 'isDelivered'],
  properties: {
    trackingNumber: { type: 'string' },
    isDelivered: { type: 'boolean' },
    statusType: { type: 'string', enum: ['delivered', 'in_transit'] },
  },
}

/** What shopify/quickbooks/github publish: `z.record(z.string(), z.unknown())`. */
const openOutputs = {
  type: 'object',
  propertyNames: { type: 'string' },
  additionalProperties: {},
}

function op(key: string, outputsJsonSchema: unknown): CachedBlockOp {
  const [resource = '', operation = ''] = key.split('.')
  return {
    key,
    resource,
    operation,
    toolId: `tool_${operation}`,
    inputsJsonSchema: {},
    outputsJsonSchema: outputsJsonSchema as Record<string, unknown>,
    requiresConnection: true,
  }
}

function block(ops: CachedBlockOp[]): CachedWorkflowBlock {
  return {
    id: 'fedex',
    label: 'FedEx',
    iconKey: null,
    inputsJsonSchema: {},
    toolMap: {},
    refs: [],
    ops,
  }
}

const tracked = block([op('shipment.track', trackOutputs), op('shipment.watch', openOutputs)])

describe('schemaPropertiesToUnifiedVariables', () => {
  it('flattens top-level properties into one variable each', () => {
    const vars = schemaPropertiesToUnifiedVariables(trackOutputs, NODE)

    // The engine writes `setNodeVariable(nodeId, fieldName, …)` per top-level
    // key, so these ids ARE the refs the agent may write. A wrapper variable
    // here would produce `{{node.structured_output.trackingNumber}}` — a ref
    // that passes ref-checking and then resolves to nothing at run time.
    expect(vars.map((v) => v.id)).toEqual([
      `${NODE}.trackingNumber`,
      `${NODE}.isDelivered`,
      `${NODE}.statusType`,
    ])
    expect(vars.some((v) => v.id.includes('structured_output'))).toBe(false)
  })

  it('carries type and enum through', () => {
    const byId = new Map(
      schemaPropertiesToUnifiedVariables(trackOutputs, NODE).map((v) => [v.id, v])
    )

    expect(byId.get(`${NODE}.isDelivered`)?.type).toBe('boolean')
    expect(byId.get(`${NODE}.statusType`)?.enum).toEqual(['delivered', 'in_transit'])
  })

  it('nests object properties under their parent path', () => {
    const vars = schemaPropertiesToUnifiedVariables(
      {
        type: 'object',
        properties: { address: { type: 'object', properties: { city: { type: 'string' } } } },
      },
      NODE
    )

    expect(vars[0]?.id).toBe(`${NODE}.address`)
    expect(vars[0]?.properties?.city?.id).toBe(`${NODE}.address.city`)
  })

  it('returns nothing for a property-less or absent schema', () => {
    expect(schemaPropertiesToUnifiedVariables(openOutputs, NODE)).toEqual([])
    expect(schemaPropertiesToUnifiedVariables(undefined, NODE)).toEqual([])
    expect(schemaPropertiesToUnifiedVariables(null, NODE)).toEqual([])
  })
})

describe('fieldNodeMapToUnifiedVariables', () => {
  // The SDK field `toJSON()` shape — what `opOutputsJsonSchema` carries. NOT a
  // JSON Schema; there is no `properties` key to find.
  it('converts a field-node map that a JSON-Schema reader would see as empty', () => {
    const map = {
      trackingNumber: { type: 'string', _metadata: { label: 'Tracking number' } },
      isDelivered: { type: 'boolean', _metadata: {} },
    }

    expect(fieldNodeMapToUnifiedVariables(map, NODE).map((v) => [v.id, v.type, v.label])).toEqual([
      [`${NODE}.trackingNumber`, 'string', 'Tracking number'],
      [`${NODE}.isDelivered`, 'boolean', expect.any(String)],
    ])
    // The load-bearing assertion: the other converter finds nothing here.
    expect(schemaPropertiesToUnifiedVariables(map, NODE)).toEqual([])
  })

  it('descends structs via `fields` and arrays via `items`', () => {
    // Shopify's real shape: one top-level `order` struct with nested fields.
    const map = {
      order: {
        type: 'struct',
        _metadata: { label: 'Order' },
        fields: {
          currency: { type: 'string' },
          lineItems: { type: 'array', items: { type: 'string' } },
        },
      },
    }

    const [order] = fieldNodeMapToUnifiedVariables(map, NODE)
    expect(order?.id).toBe(`${NODE}.order`)
    expect(order?.type).toBe('object')
    expect(order?.properties?.currency?.id).toBe(`${NODE}.order.currency`)
    expect(order?.properties?.lineItems?.items?.id).toBe(`${NODE}.order.lineItems[*]`)
  })

  it('maps SDK-only types, and refuses to guess at unknown ones', () => {
    const map = {
      total: { type: 'currency' },
      when: { type: 'datetime' },
      kind: { type: 'select', _metadata: { options: ['a', 'b'] } },
      mystery: { type: 'quantum-flux' },
    }
    const byId = new Map(fieldNodeMapToUnifiedVariables(map, NODE).map((v) => [v.id, v]))

    expect(byId.get(`${NODE}.total`)?.type).toBe('currency')
    expect(byId.get(`${NODE}.when`)?.type).toBe('datetime')
    expect(byId.get(`${NODE}.kind`)?.type).toBe('enum')
    expect(byId.get(`${NODE}.kind`)?.enum).toEqual(['a', 'b'])
    // ANY, not a confidently-wrong STRING.
    expect(byId.get(`${NODE}.mystery`)?.type).toBe('any')
  })

  it('returns nothing for absent or non-object input', () => {
    expect(fieldNodeMapToUnifiedVariables(undefined, NODE)).toEqual([])
    expect(fieldNodeMapToUnifiedVariables({}, NODE)).toEqual([])
  })
})

describe('resolveAppBlockOutputs', () => {
  it('prefers the block’s computeOutputs over the dispatched tool’s outputs', () => {
    // Rung 2a beats 2b: the block's own answer is also the canvas's answer, so
    // preferring it keeps agent and canvas in agreement.
    const withComputed: CachedWorkflowBlock = {
      ...tracked,
      opOutputsJsonSchema: {
        'shipment.track': { fromCompute: { type: 'string', _metadata: { label: 'From compute' } } },
      },
    }

    const result = resolveAppBlockOutputs(
      withComputed,
      { resource: 'shipment', operation: 'track' },
      NODE
    )

    expect(result.status).toBe('resolved')
    expect(result.variables.map((v) => v.id)).toEqual([`${NODE}.fromCompute`])
  })

  it('falls back to the tool’s outputs when computeOutputs gave nothing for that op', () => {
    // What a throwing or unhandled selection looks like: `{}` at that key.
    const threw: CachedWorkflowBlock = {
      ...tracked,
      opOutputsJsonSchema: { 'shipment.track': {} },
    }

    const result = resolveAppBlockOutputs(threw, { resource: 'shipment', operation: 'track' }, NODE)

    expect(result.status).toBe('resolved')
    expect(result.variables.map((v) => v.id)).toContain(`${NODE}.trackingNumber`)
  })

  it('reports undeclared when neither computeOutputs nor the tool declares anything', () => {
    const nothing: CachedWorkflowBlock = {
      ...block([op('shipment.watch', openOutputs)]),
      opOutputsJsonSchema: { 'shipment.watch': {} },
    }

    expect(
      resolveAppBlockOutputs(nothing, { resource: 'shipment', operation: 'watch' }, NODE)
    ).toEqual({ variables: [], status: 'undeclared' })
  })

  it('resolves the selected operation’s declared outputs', () => {
    const result = resolveAppBlockOutputs(
      tracked,
      { resource: 'shipment', operation: 'track' },
      NODE
    )

    expect(result.status).toBe('resolved')
    expect(result.variables.map((v) => v.id)).toEqual([
      `${NODE}.trackingNumber`,
      `${NODE}.isDelivered`,
      `${NODE}.statusType`,
    ])
  })

  it('reports no-operation-selected on a half-configured draft', () => {
    expect(resolveAppBlockOutputs(tracked, {}, NODE)).toEqual({
      variables: [],
      status: 'no-operation-selected',
    })
    expect(resolveAppBlockOutputs(tracked, { resource: 'shipment' }, NODE).status).toBe(
      'no-operation-selected'
    )
    expect(resolveAppBlockOutputs(tracked, undefined, NODE).status).toBe('no-operation-selected')
  })

  it('reports unknown-operation when the toolMap has no such key', () => {
    // What an app upgrade that drops an op looks like to a stored node.
    expect(
      resolveAppBlockOutputs(tracked, { resource: 'shipment', operation: 'teleport' }, NODE)
    ).toEqual({ variables: [], status: 'unknown-operation' })
  })

  it('reports undeclared — not resolved — for an open output schema', () => {
    // 190 of 261 published ops are in this state. "Unknown shape" must be
    // distinguishable from "produces nothing", or the agent is told with
    // confidence that a Shopify block emits no variables.
    const result = resolveAppBlockOutputs(
      tracked,
      { resource: 'shipment', operation: 'watch' },
      NODE
    )

    expect(result).toEqual({ variables: [], status: 'undeclared' })
    expect(result.status).not.toBe('resolved')
  })

  it('lets a real run’s inferredSchema win over the declaration', () => {
    const result = resolveAppBlockOutputs(
      tracked,
      {
        resource: 'shipment',
        operation: 'track',
        inferredSchema: {
          type: 'object',
          properties: { trackingNumber: { type: 'number' }, extraFromRun: { type: 'string' } },
        },
      },
      NODE
    )

    expect(result.status).toBe('inferred')
    // Declared order preserved; the overlapping field takes the observed type;
    // run-only fields append. Same precedence as the canvas's merge.
    expect(result.variables.map((v) => v.id)).toEqual([
      `${NODE}.trackingNumber`,
      `${NODE}.isDelivered`,
      `${NODE}.statusType`,
      `${NODE}.extraFromRun`,
    ])
    expect(result.variables[0]?.type).toBe('number')
  })

  it('falls back to inferredSchema when the declaration is open', () => {
    const result = resolveAppBlockOutputs(
      tracked,
      {
        resource: 'shipment',
        operation: 'watch',
        inferredSchema: { type: 'object', properties: { watchId: { type: 'string' } } },
      },
      NODE
    )

    expect(result.status).toBe('inferred')
    expect(result.variables.map((v) => v.id)).toEqual([`${NODE}.watchId`])
  })

  it('falls back to inferredSchema when the operation is unknown', () => {
    const result = resolveAppBlockOutputs(
      tracked,
      {
        resource: 'shipment',
        operation: 'teleport',
        inferredSchema: { type: 'object', properties: { whatever: { type: 'string' } } },
      },
      NODE
    )

    expect(result.status).toBe('inferred')
    expect(result.variables.map((v) => v.id)).toEqual([`${NODE}.whatever`])
  })

  it('falls back to the block’s own declared outputs when the op declares none', () => {
    // Rung 3: a non-router block that declares its shape once, op-independent.
    // Also what keeps A1's `CatalogBlock.outputsJsonSchema` from being dead data.
    const nonRouter: CachedWorkflowBlock = {
      ...block([op('shipment.watch', openOutputs)]),
      outputsJsonSchema: { type: 'object', properties: { watchId: { type: 'string' } } },
    }

    expect(
      resolveAppBlockOutputs(nonRouter, { resource: 'shipment', operation: 'watch' }, NODE)
    ).toEqual({
      variables: [expect.objectContaining({ id: `${NODE}.watchId` })],
      status: 'resolved',
    })
  })

  it('prefers the op’s outputs over the block’s own when both exist', () => {
    const both: CachedWorkflowBlock = {
      ...tracked,
      outputsJsonSchema: { type: 'object', properties: { blockLevel: { type: 'string' } } },
    }

    const ids = resolveAppBlockOutputs(
      both,
      { resource: 'shipment', operation: 'track' },
      NODE
    ).variables.map((v) => v.id)

    expect(ids).toContain(`${NODE}.trackingNumber`)
    expect(ids).not.toContain(`${NODE}.blockLevel`)
  })

  it('resolves block-level outputs even with no operation picked', () => {
    // Op-independent by definition, so not selecting an op does not hide them.
    const nonRouter: CachedWorkflowBlock = {
      ...block([]),
      outputsJsonSchema: { type: 'object', properties: { watchId: { type: 'string' } } },
    }

    expect(resolveAppBlockOutputs(nonRouter, {}, NODE).status).toBe('resolved')
  })

  it('returns nothing for a block whose ops never got projected', () => {
    // A catalog published before the A2 join, or a block with no toolMap.
    expect(
      resolveAppBlockOutputs(block([]), { resource: 'shipment', operation: 'track' }, NODE)
    ).toEqual({ variables: [], status: 'unknown-operation' })
  })
})
