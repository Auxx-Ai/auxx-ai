// packages/lib/src/workflow-engine/catalog/app-manifests.test.ts
// Server-side app-block output resolution. Pure over catalog shapes — the org
// cache read (`buildAppBlockLookup`) is covered by resolve-outputs.test.ts,
// which exercises it through the graph walk.
//
// See plans/kopilot/workflow/17-app-block-authoring-and-connections.md §4 A3.

import { describe, expect, it, vi } from 'vitest'
import type {
  CachedBlockOp,
  CachedInstalledApp,
  CachedWorkflowBlock,
} from '../../cache/org-cache-keys'

// Partial mock — the cache barrel is imported by half of lib, and replacing it
// wholesale dies at collection. Only the one read this module makes is stubbed.
const getCachedInstalledApps = vi.fn()
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cache')>()),
  getCachedInstalledApps: (...args: unknown[]) => getCachedInstalledApps(...args),
}))

import {
  buildManifestLookup,
  fieldNodeMapToUnifiedVariables,
  resolveAppBlockOutputs,
  schemaPropertiesToUnifiedVariables,
  synthesizeAppBlockManifest,
} from './app-manifests'
import { NodeCategory } from './types'

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

// ---------------------------------------------------------------------------
// The synthesized manifest (PR B1)
// ---------------------------------------------------------------------------

/** The block's own `inputsJsonSchema` — the SDK field `toJSON()` map the panel declares. */
const fedexInputs: Record<string, unknown> = {
  resource: { type: 'select', _metadata: { options: ['shipment'] } },
  operation: { type: 'select', _metadata: { options: ['track', 'watch'] } },
  trackingNumber: { type: 'string', _metadata: { label: 'Tracking number' } },
  referenceType: {
    type: 'select',
    _metadata: { options: ['PART_NUMBER'], defaultValue: 'PART_NUMBER' },
  },
}

function installedApp(overrides: Partial<CachedInstalledApp> = {}): CachedInstalledApp {
  return {
    installationId: 'inst_1',
    installationType: 'production',
    installedAt: '2026-08-01T00:00:00.000Z',
    app: {
      id: 'z3prnwpd3rt31mp7f9yxo5m6',
      slug: 'fedex',
      title: 'FedEx',
      description: null,
      avatarUrl: null,
      category: null,
    },
    currentDeployment: null,
    methods: [],
    connectionDefinitions: {},
    orgConnectionPresent: true,
    orgConnectionExpiresAt: null,
    ...overrides,
  } as CachedInstalledApp
}

/** A block shaped like the real FedEx one: two ops, declared panel inputs. */
function fedexBlock(overrides: Partial<CachedWorkflowBlock> = {}): CachedWorkflowBlock {
  return {
    ...block([op('shipment.track', trackOutputs), op('shipment.watch', openOutputs)]),
    description: 'Track FedEx shipments',
    inputsJsonSchema: fedexInputs,
    toolMap: { 'shipment.track': 'tool_track', 'shipment.watch': 'tool_watch' },
    ...overrides,
  }
}

const APP_TYPE = 'z3prnwpd3rt31mp7f9yxo5m6:fedex'

function manifestFor(
  blockOverrides: Partial<CachedWorkflowBlock> = {},
  appOverrides: Partial<CachedInstalledApp> = {}
) {
  return synthesizeAppBlockManifest(installedApp(appOverrides), fedexBlock(blockOverrides))
}

/** Config an agent would have to write to get a clean node — the "healthy" baseline. */
const healthyConfig = {
  type: APP_TYPE,
  appId: 'z3prnwpd3rt31mp7f9yxo5m6',
  blockId: 'fedex',
  resource: 'shipment',
  operation: 'track',
  trackingNumber: '123',
}

describe('synthesizeAppBlockManifest — shape', () => {
  it('parses its own defaultData with its own configSchema', () => {
    // The invariant `catalog-coverage.test.ts` enforces for every REGISTERED
    // manifest. Synthesized ones are outside that suite's set by design, so it
    // has to be asserted here or nothing checks it.
    const manifest = manifestFor()

    expect(manifest.configSchema.safeParse(manifest.defaultData()).success).toBe(true)
  })

  it('stamps identity and the first operation into defaultData', () => {
    expect(manifestFor().defaultData()).toMatchObject({
      type: APP_TYPE,
      appId: 'z3prnwpd3rt31mp7f9yxo5m6',
      appSlug: 'fedex',
      blockId: 'fedex',
      title: 'FedEx',
      resource: 'shipment',
      operation: 'track',
      // From the panel field's declared `_metadata.defaultValue`.
      referenceType: 'PART_NUMBER',
    })
    // Resolved at run time from `appId`; the canvas does not persist it either.
    expect(manifestFor().defaultData()).not.toHaveProperty('installationId')
  })

  it('is an INTEGRATION node that never accepts input wiring', () => {
    // Until B1 this was enforced by accident — `isInputNodePair` disqualified
    // any node whose manifest was missing. That stops being true the moment app
    // blocks HAVE manifests, so both facts are now explicit.
    const manifest = manifestFor()

    expect(manifest.category).toBe(NodeCategory.INTEGRATION)
    expect(manifest.connection.acceptsInputNodes).toBe(false)
    expect(manifest.connection.branches).toBeUndefined()
  })

  it('honours the projected canRunSingle, defaulting to true', () => {
    // `undefined` is a pre-projection catalog, and today's behaviour for those
    // is runnable — `run-node.ts` only refuses on an explicit `false`.
    expect(manifestFor().connection.canRunSingle).toBe(true)
    expect(manifestFor({ canRunSingle: false }).connection.canRunSingle).toBe(false)
  })

  it('keeps app-authored config keys through the schema, and declares no derived key', () => {
    const parsed = manifestFor().configSchema.safeParse({
      ...healthyConfig,
      somethingTheAppInvented: 'kept',
    })

    expect(parsed.success && (parsed.data as Record<string, unknown>).somethingTheAppInvented).toBe(
      'kept'
    )
    // No `configSchema` may declare a derived (`_`-prefixed) key — the invariant
    // `derived-keys.ts` exists to protect, which cost every stored HTTP node a
    // permanent unfixable warning when it was broken.
    const shape = (manifestFor().configSchema as unknown as { shape: Record<string, unknown> })
      .shape
    expect(Object.keys(shape).filter((k) => k.startsWith('_'))).toEqual([])
  })

  it('rejects an operation the block does not offer, at the schema level', () => {
    expect(
      manifestFor().configSchema.safeParse({ ...healthyConfig, operation: 'teleport' }).success
    ).toBe(false)
  })

  it('degrades to a free-string operation when the catalog predates the ops projection', () => {
    // An enum over an empty op set would reject every stored node.
    const manifest = manifestFor({ ops: [], toolMap: {} })

    expect(
      manifest.configSchema.safeParse({ ...healthyConfig, operation: 'anything' }).success
    ).toBe(true)
  })

  it('is authorable, and names its operations in bounded usage text', () => {
    const manifest = manifestFor()

    expect(manifest.agent?.authorable).toBe(true)
    expect(manifest.agent?.usage).toContain('shipment.track')
    expect(manifest.agent?.examples[0]?.config).toMatchObject({
      resource: 'shipment',
      operation: 'track',
    })
  })

  it('summarizes instead of listing when a block has many operations', () => {
    // QuickBooks has 42 behind one type; the prompt budget is not unbounded.
    const many = Array.from({ length: 40 }, (_, i) => op(`res.op${i}`, openOutputs))
    const usage = manifestFor({ ops: many }).agent?.usage ?? ''

    expect(usage).toContain('more (call describe_app_block)')
    expect(usage).not.toContain('res.op39')
  })

  it('delegates resolveOutputs to the ladder', () => {
    const vars = manifestFor().resolveOutputs?.(
      { resource: 'shipment', operation: 'track' },
      NODE,
      { allResources: [], resolveVariable: () => undefined }
    )

    expect(vars?.map((v) => v.id)).toContain(`${NODE}.trackingNumber`)
  })
})

describe('synthesizeAppBlockManifest — validate', () => {
  /** Only the errors whose message concerns `field`, so a table stays readable. */
  const errorsFor = (config: Record<string, unknown>, field: string, manifest = manifestFor()) =>
    manifest.validate(config).errors.filter((e) => e.field === field)

  it('accepts a fully configured node', () => {
    const result = manifestFor().validate(healthyConfig)

    expect(result.isValid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('errors on an operation the block no longer offers', () => {
    // Tier 2, so this gates `run_node` for this node and NOTHING else — the
    // mutation-blocking half lives in `validateGraphStructure`, keyed on
    // `newNodeIds`, so one drifted node never makes a workflow uneditable.
    const errors = errorsFor({ ...healthyConfig, operation: 'teleport' }, 'operation')

    expect(errors[0]?.type).toBe('error')
    expect(errors[0]?.message).toContain('shipment.track')
  })

  it('errors when no operation is selected', () => {
    expect(errorsFor({ type: APP_TYPE }, 'operation')[0]?.type).toBe('error')
  })

  it('says nothing about operations when the catalog predates the ops projection', () => {
    // Flagging every healthy node until its app is republished would be worse
    // than silence.
    const manifest = manifestFor({ ops: [], toolMap: {} })

    expect(errorsFor({ type: APP_TYPE }, 'operation', manifest)).toEqual([])
  })

  it('warns — never errors — on a missing required tool input', () => {
    // Advisory: most blocks forward the flat panel input unchanged, but some
    // project it first, so a required name here is the TOOL's, not the block's.
    const withRequired = manifestFor({
      ops: [
        {
          ...op('shipment.track', trackOutputs),
          inputsJsonSchema: {
            type: 'object',
            required: ['trackingNumber'],
            properties: { trackingNumber: { type: 'string' } },
          },
        },
      ],
    })

    const errors = errorsFor(
      { ...healthyConfig, trackingNumber: '' },
      'trackingNumber',
      withRequired
    )
    expect(errors[0]?.type).toBe('warning')
    expect(withRequired.validate(healthyConfig).errors).toEqual([])
  })

  it('warns about a {{ref}} stranded in a constant-mode field', () => {
    // The engine passes constant fields through RAW, so the app receives the
    // literal text. Nothing else reports it: `extractVariables` mirrors the
    // engine and skips constant fields, so ref-checking cannot see it either.
    const errors = errorsFor(
      { ...healthyConfig, trackingNumber: '{{FedEx.trackingNumber}}' },
      'trackingNumber'
    )

    expect(errors[0]?.type).toBe('warning')
    expect(errors[0]?.message).toContain('fieldModes.trackingNumber')
  })

  it('says nothing when that same ref is properly in variable mode', () => {
    expect(
      errorsFor(
        {
          ...healthyConfig,
          trackingNumber: '{{FedEx.trackingNumber}}',
          fieldModes: { trackingNumber: false },
        },
        'trackingNumber'
      )
    ).toEqual([])
  })
})

describe('synthesizeAppBlockManifest — the connection issue', () => {
  const connectionErrors = (
    app: Partial<CachedInstalledApp>,
    blockOverrides: Partial<CachedWorkflowBlock> = {}
  ) =>
    manifestFor(blockOverrides, app)
      .validate(healthyConfig)
      .errors.filter((e) => e.field === 'connectionId')

  it('says nothing when the node is simply unbound and the workspace is connected', () => {
    // Unbound is the NORMAL, healthy state: the runtime resolver takes its
    // `appId` arm and picks the org default. Firing on a missing `connectionId`
    // would put an issue on nearly every app node in every workflow.
    expect(connectionErrors({ orgConnectionPresent: true })).toEqual([])
  })

  it('errors when the block declares it needs a connection and the workspace has none', () => {
    const errors = connectionErrors({ orgConnectionPresent: false }, { requiresConnection: true })

    expect(errors[0]?.type).toBe('error')
    expect(errors[0]?.message).toContain('Settings → Apps → FedEx → Connections')
  })

  it('only warns when the requirement is the per-app approximation', () => {
    // `requiresConnection: undefined` means UNKNOWN, not false — the catalog
    // predates the projection. Refusing to run on an approximation would punish
    // a block that may genuinely need no connection.
    const errors = connectionErrors({
      orgConnectionPresent: false,
      connectionDefinitions: { organization: {} as never },
    })

    expect(errors[0]?.type).toBe('warning')
  })

  it('says nothing when the app declares no connection definition at all', () => {
    expect(connectionErrors({ orgConnectionPresent: false })).toEqual([])
  })

  it('says nothing when the block declares it needs no connection', () => {
    expect(
      connectionErrors({ orgConnectionPresent: false }, { requiresConnection: false })
    ).toEqual([])
  })

  it('warns when the workspace connection is present but expired', () => {
    const errors = connectionErrors({
      orgConnectionPresent: true,
      orgConnectionExpiresAt: '2020-01-01T00:00:00.000Z',
    })

    expect(errors[0]?.type).toBe('warning')
    expect(errors[0]?.message).toContain('expired')
  })
})

describe('synthesizeAppBlockManifest — extractVariables', () => {
  const extract = (config: Record<string, unknown>) =>
    manifestFor().extractVariables?.(config) ?? []

  it('reads refs only from fields in variable mode', () => {
    // Exactly the engine's contract, and the canvas's. All three must agree on
    // which strings are refs, or ref-checking validates a different set than
    // the one that gets resolved.
    expect(
      extract({
        ...healthyConfig,
        trackingNumber: '{{other.value}}',
        fieldModes: { trackingNumber: false },
      })
    ).toEqual(['other.value'])

    expect(extract({ ...healthyConfig, trackingNumber: '{{other.value}}' })).toEqual([])
  })

  it('treats a bare value in variable mode as a PICKER-mode path', () => {
    expect(
      extract({
        ...healthyConfig,
        trackingNumber: 'node_a.id',
        fieldModes: { trackingNumber: false },
      })
    ).toEqual(['node_a.id'])
  })

  it('never reads a platform-owned key', () => {
    expect(
      extract({
        ...healthyConfig,
        title: '{{never.this}}',
        connectionId: '{{nor.this}}',
        fieldModes: { title: false, connectionId: false },
      })
    ).toEqual([])
  })
})

describe('buildManifestLookup', () => {
  it('resolves core types from the registry and app blocks from the org cache', async () => {
    getCachedInstalledApps.mockReset()
    getCachedInstalledApps.mockResolvedValue([
      { ...installedApp(), workflowBlocks: [fedexBlock()] },
    ])

    const lookup = await buildManifestLookup('org_1')

    expect(lookup('wait')?.id).toBe('wait')
    expect(lookup(APP_TYPE)?.category).toBe(NodeCategory.INTEGRATION)
    // An uninstalled app's leftover node: the provider filters it out, so it
    // simply does not resolve and stays read-only.
    expect(lookup('some-other-app:block')).toBeUndefined()
  })

  it('widens the lookup, never the registry', async () => {
    // `catalog-coverage.test.ts` asserts exact set equality between the
    // `NodeType` enum and {registered manifests ∪ NOT_YET_MIGRATED}. An app
    // block is in neither, so it must never enter the shared Map.
    getCachedInstalledApps.mockReset()
    getCachedInstalledApps.mockResolvedValue([
      { ...installedApp(), workflowBlocks: [fedexBlock()] },
    ])
    await buildManifestLookup('org_1')

    const { getManifest, listManifests } = await import('./registry')
    expect(getManifest(APP_TYPE)).toBeUndefined()
    expect(listManifests().some((m) => m.id.includes(':'))).toBe(false)
  })
})
