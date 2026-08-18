// packages/lib/src/workflow-engine/catalog/resolve-outputs.test.ts

import { describe, expect, it, vi } from 'vitest'
import type { Resource } from '../../resources/client'
import { BaseType } from '../core/types'

// Partial mock — the cache barrel is imported by half of lib; replacing it wholesale
// dies at collection (see `resource-trigger-base.test.ts`). Only the one read this
// module makes is stubbed.
const getCachedResources = vi.fn()
const getCachedInstalledApps = vi.fn()
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
  getCachedInstalledApps: (...args: unknown[]) => getCachedInstalledApps(...args),
}))

// Partial mock: a synthetic `__throwing__` type whose resolver always crashes,
// for the crash-isolation test; every real type passes through untouched.
vi.mock('./registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registry')>()
  return {
    ...actual,
    getManifest: (type: string) =>
      type === '__throwing__'
        ? {
            ...actual.getManifest('wait'),
            resolveOutputs: () => {
              throw new Error('boom')
            },
          }
        : actual.getManifest(type),
  }
})

const { resolveGraphOutputs, resolveNodeOutputs } = await import('./resolve-outputs')

const noResources = () => {
  getCachedResources.mockReset()
  getCachedResources.mockResolvedValue([])
  getCachedInstalledApps.mockReset()
  getCachedInstalledApps.mockResolvedValue([])
}

/** `var-assign` node data producing an ARRAY output — a deterministic, resource-free
 * upstream producer for `list`'s `context.resolveVariable` chain. */
const varAssignArrayNode = (id: string, name: string) => ({
  id,
  type: 'var-assign',
  data: {
    id,
    type: 'var-assign',
    title: 'Assign',
    variables: [{ id: 'a1', name, type: BaseType.STRING, value: '', isArray: true }],
    ignoreTypeError: false,
  },
})

/** `list` node data reading `{{sourceId.name}}` with the `filter` operation, which
 * preserves the input array's item structure. */
const listFilterNode = (id: string, sourceId: string, name: string) => ({
  id,
  type: 'list',
  data: {
    id,
    type: 'list',
    title: 'List Operations',
    operation: 'filter' as const,
    inputList: `{{${sourceId}.${name}}}`,
    filterConfig: { conditions: [], logic: 'AND' as const },
  },
})

describe('resolveGraphOutputs', () => {
  it('resolves an isolated node with no upstream', async () => {
    noResources()
    const graph = { nodes: [varAssignArrayNode('n1', 'items')], edges: [] }

    const result = await resolveGraphOutputs('org-1', { graph })

    expect(result.isOk()).toBe(true)
    const outputs = result._unsafeUnwrap().get('n1')
    expect(outputs).toEqual([expect.objectContaining({ id: 'n1.items', type: BaseType.ARRAY })])
  })

  it("resolves list's item type from its upstream var-assign node — the upstream chain the plan's §7 calls out", async () => {
    noResources()
    const graph = {
      nodes: [varAssignArrayNode('n1', 'items'), listFilterNode('n2', 'n1', 'items')],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    }

    const result = await resolveGraphOutputs('org-1', { graph })
    const memo = result._unsafeUnwrap()

    // n1.items[*] is STRING (var-assign's declared item type); filter preserves it.
    const listResult = memo.get('n2')?.find((v) => v.id === 'n2.result')
    expect(listResult?.type).toBe(BaseType.ARRAY)
    expect(listResult?.items?.type).toBe(BaseType.STRING)
  })

  it('falls back to an empty array for a not-yet-migrated node type (crud/find today) instead of throwing', async () => {
    noResources()
    const graph = {
      nodes: [
        { id: 'n1', type: 'crud', data: { id: 'n1', type: 'crud', resourceType: 'contact' } },
      ],
      edges: [],
    }

    const result = await resolveGraphOutputs('org-1', { graph })
    expect(result._unsafeUnwrap().get('n1')).toEqual([])
  })

  it('plumbs the resource looked up by resourceType into a context-reading resolver (resource-trigger)', async () => {
    const CONTACT = {
      id: 'contact',
      entityType: 'contact',
      apiSlug: 'contacts',
      label: 'Contact',
      plural: 'Contacts',
      fields: [],
    } as unknown as Resource
    getCachedResources.mockReset()
    getCachedResources.mockResolvedValue([CONTACT])

    const graph = {
      nodes: [
        {
          id: 'n1',
          type: 'resource-trigger',
          data: {
            id: 'n1',
            type: 'resource-trigger',
            title: 'Contact Created',
            resourceType: 'contact',
            operation: 'created' as const,
          },
        },
      ],
      edges: [],
    }

    const result = await resolveGraphOutputs('org-1', { graph })
    // No fields on the fixture resource ⇒ falls back to trigger-metadata-only output —
    // still proves the resource was found and handed to the resolver rather than
    // short-circuiting on "no resource selected" (the `undefined` case would be []).
    expect(result._unsafeUnwrap().get('n1')?.length).toBeGreaterThan(0)
  })

  it('leaves `resource` undefined (not an error) when resourceType matches nothing, same as no resource picked', async () => {
    noResources()
    const graph = {
      nodes: [
        {
          id: 'n1',
          type: 'resource-trigger',
          data: {
            id: 'n1',
            type: 'resource-trigger',
            title: 'X',
            resourceType: 'does-not-exist',
            operation: 'created' as const,
          },
        },
      ],
      edges: [],
    }

    const result = await resolveGraphOutputs('org-1', { graph })
    expect(result._unsafeUnwrap().get('n1')).toEqual([])
  })

  it('terminates on a hand-authored non-loop cycle instead of hanging, resolving best-effort', async () => {
    noResources()
    // n1 -> n2 -> n1, no `isLoopBackEdge` marker — not the canvas's intentional loop
    // shape, just a malformed agent-authored graph.
    const graph = {
      nodes: [varAssignArrayNode('n1', 'items'), listFilterNode('n2', 'n1', 'items')],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n1' },
      ],
    }

    const result = await resolveGraphOutputs('org-1', { graph })
    expect(result.isOk()).toBe(true)
    // Both nodes still get an entry — no hang, no thrown error.
    expect(result._unsafeUnwrap().has('n1')).toBe(true)
    expect(result._unsafeUnwrap().has('n2')).toBe(true)
  })
})

describe('resolveNodeOutputs', () => {
  it('returns NotFoundError for a nodeId absent from the graph', async () => {
    noResources()
    const graph = { nodes: [varAssignArrayNode('n1', 'items')], edges: [] }

    const result = await resolveNodeOutputs('org-1', { graph, nodeId: 'missing' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().name).toBe('NotFoundError')
  })

  it('resolves a downstream node using only its ancestors, matching resolveGraphOutputs', async () => {
    noResources()
    const graph = {
      nodes: [varAssignArrayNode('n1', 'items'), listFilterNode('n2', 'n1', 'items')],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    }

    const result = await resolveNodeOutputs('org-1', { graph, nodeId: 'n2' })
    const outputs = result._unsafeUnwrap()

    const listResult = outputs.find((v) => v.id === 'n2.result')
    expect(listResult?.items?.type).toBe(BaseType.STRING)
  })

  it('ignores unrelated sibling branches — only fetches the org cache once for the call', async () => {
    noResources()
    const graph = {
      nodes: [
        varAssignArrayNode('n1', 'items'),
        listFilterNode('n2', 'n1', 'items'),
        // Unrelated branch — should not affect resolving n2, and shouldn't need a
        // second cache read.
        { id: 'n3', type: 'crud', data: { id: 'n3', type: 'crud', resourceType: 'contact' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    }

    await resolveNodeOutputs('org-1', { graph, nodeId: 'n2' })
    expect(getCachedResources).toHaveBeenCalledTimes(1)
  })
})

describe('resolver crash isolation', () => {
  it('resolves a scheduled trigger with missing config (legacy rows) without crashing', async () => {
    noResources()
    const graph = {
      nodes: [
        { id: 's1', type: 'scheduled', data: { id: 's1', type: 'scheduled', title: 'Schedule' } },
      ],
      edges: [],
    }

    const result = await resolveGraphOutputs('org-1', { graph })

    expect(result.isOk()).toBe(true)
    const ids = (result._unsafeUnwrap().get('s1') ?? []).map((v) => v.id)
    // No config falls into the interval branch, matching defaultData()'s shape.
    expect(ids).toEqual([
      's1.triggered_at',
      's1.schedule_type',
      's1.is_test_run',
      's1.interval_config',
    ])
  })

  it('degrades a crashing resolver to empty outputs instead of failing the graph', async () => {
    noResources()
    const graph = {
      nodes: [
        {
          id: 'bad',
          type: '__throwing__',
          data: { id: 'bad', type: '__throwing__', title: 'Bad' },
        },
        varAssignArrayNode('ok', 'items'),
      ],
      edges: [],
    }

    const result = await resolveGraphOutputs('org-1', { graph })

    expect(result.isOk()).toBe(true)
    const outputs = result._unsafeUnwrap()
    expect(outputs.get('bad')).toEqual([])
    expect((outputs.get('ok') ?? []).length).toBeGreaterThan(0)
  })
})

describe('scheduled manifest config-less guards', () => {
  it('extractScheduledTriggerVariables returns [] when config is absent', async () => {
    const { extractScheduledTriggerVariables } = await import('./nodes/scheduled')
    expect(
      extractScheduledTriggerVariables({ id: 's1', type: 'scheduled', title: 'Schedule' } as never)
    ).toEqual([])
  })
})

describe('app-block nodes', () => {
  const APP = 'z3prnwpd3rt31mp7f9yxo5m6'
  const TYPE = `${APP}:fedex`
  const NODE_ID = `${TYPE}-DmJuCD8M2cAE0Hqdua0Ns`

  /** One installed app contributing one block with one declared operation. */
  const installedFedex = () => [
    {
      app: { id: APP, slug: 'fedex' },
      workflowBlocks: [
        {
          id: 'fedex',
          label: 'FedEx',
          iconKey: null,
          inputsJsonSchema: {},
          toolMap: { 'shipment.track': 'fedex_block_track' },
          refs: [],
          ops: [
            {
              key: 'shipment.track',
              resource: 'shipment',
              operation: 'track',
              toolId: 'fedex_block_track',
              inputsJsonSchema: {},
              outputsJsonSchema: {
                type: 'object',
                properties: {
                  trackingNumber: { type: 'string' },
                  isDelivered: { type: 'boolean' },
                },
              },
              requiresConnection: true,
            },
          ],
        },
      ],
    },
  ]

  const fedexNode = (data: Record<string, unknown>) => ({
    id: NODE_ID,
    type: 'standard',
    data: { id: NODE_ID, type: TYPE, title: 'FedEx', appId: APP, blockId: 'fedex', ...data },
  })

  it('resolves outputs from the catalog projection, not the core registry', async () => {
    // The §1 regression: this returned [] for every app block, which let the
    // agent write `{{FedEx.record.id}}` and have it pass ref-checking.
    noResources()
    getCachedInstalledApps.mockResolvedValue(installedFedex())
    const graph = { nodes: [fedexNode({ resource: 'shipment', operation: 'track' })], edges: [] }

    const result = await resolveGraphOutputs('org-1', { graph })

    expect(
      result
        ._unsafeUnwrap()
        .get(NODE_ID)
        ?.map((v) => v.id)
    ).toEqual([`${NODE_ID}.trackingNumber`, `${NODE_ID}.isDelivered`])
  })

  it('resolves the same node through the single-node entry point', async () => {
    noResources()
    getCachedInstalledApps.mockResolvedValue(installedFedex())
    const graph = { nodes: [fedexNode({ resource: 'shipment', operation: 'track' })], edges: [] }

    const result = await resolveNodeOutputs('org-1', { graph, nodeId: NODE_ID })

    expect(result._unsafeUnwrap().map((v) => v.id)).toEqual([
      `${NODE_ID}.trackingNumber`,
      `${NODE_ID}.isDelivered`,
    ])
  })

  it('feeds an app block’s outputs to a downstream node’s resolveVariable', async () => {
    noResources()
    getCachedInstalledApps.mockResolvedValue(installedFedex())
    const graph = {
      nodes: [
        fedexNode({ resource: 'shipment', operation: 'track' }),
        listFilterNode('n2', NODE_ID, 'trackingNumber'),
      ],
      edges: [{ id: 'e1', source: NODE_ID, target: 'n2' }],
    }

    const result = await resolveGraphOutputs('org-1', { graph })

    // The point is that the upstream memo entry is non-empty and the walk
    // completes — an app block is now a legitimate variable source.
    expect((result._unsafeUnwrap().get(NODE_ID) ?? []).length).toBe(2)
    expect(result.isOk()).toBe(true)
  })

  it('returns [] with no operation picked, and does not throw', async () => {
    noResources()
    getCachedInstalledApps.mockResolvedValue(installedFedex())
    const graph = { nodes: [fedexNode({})], edges: [] }

    const result = await resolveGraphOutputs('org-1', { graph })
    expect(result._unsafeUnwrap().get(NODE_ID)).toEqual([])
  })

  it('returns [] for a node whose app is no longer installed', async () => {
    // Orphan node from an uninstalled app — the provider filters uninstalled
    // rows out, so the lookup misses and the node falls through to read-only.
    noResources()
    getCachedInstalledApps.mockResolvedValue([])
    const graph = { nodes: [fedexNode({ resource: 'shipment', operation: 'track' })], edges: [] }

    const result = await resolveGraphOutputs('org-1', { graph })
    expect(result._unsafeUnwrap().get(NODE_ID)).toEqual([])
  })

  it('lets inferredSchema from a real run win', async () => {
    noResources()
    getCachedInstalledApps.mockResolvedValue(installedFedex())
    const graph = {
      nodes: [
        fedexNode({
          resource: 'shipment',
          operation: 'track',
          inferredSchema: { type: 'object', properties: { observedOnly: { type: 'string' } } },
        }),
      ],
      edges: [],
    }

    const result = await resolveGraphOutputs('org-1', { graph })

    expect(
      result
        ._unsafeUnwrap()
        .get(NODE_ID)
        ?.map((v) => v.id)
    ).toContain(`${NODE_ID}.observedOnly`)
  })

  it('skips the installed-apps read entirely for a graph of core nodes', async () => {
    // A colon-free graph must not pay for an org-cache read it cannot use.
    noResources()
    const graph = { nodes: [varAssignArrayNode('n1', 'items')], edges: [] }

    await resolveGraphOutputs('org-1', { graph })

    expect(getCachedInstalledApps).not.toHaveBeenCalled()
  })

  // The declared `Result<…, Error>` was never produced: both cache reads could
  // throw straight through it, past every caller's `isOk()` guard. Since
  // `runGraphMutation` resolves outputs BEFORE `persistDraft`, a blip in either
  // aborted an already-validated edit and lost the user's change.
  it('returns err instead of throwing when the resources read fails', async () => {
    noResources()
    getCachedResources.mockRejectedValue(new Error('redis down'))
    const graph = { nodes: [varAssignArrayNode('n1', 'items')], edges: [] }

    const result = await resolveGraphOutputs('org-1', { graph })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toBe('redis down')
  })

  it('returns err instead of throwing when the app-block lookup fails', async () => {
    noResources()
    getCachedInstalledApps.mockRejectedValue(new Error('installed apps unavailable'))
    // A colon-shaped type is what routes into `buildAppBlockLookup`.
    const graph = {
      nodes: [
        { id: 'n1', type: 'app1:block1', data: { id: 'n1', type: 'app1:block1', title: 'Block' } },
      ],
      edges: [],
    }

    const result = await resolveGraphOutputs('org-1', { graph })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toBe('installed apps unavailable')
  })

  it('wraps a non-Error throw so callers always get an Error', async () => {
    noResources()
    getCachedResources.mockRejectedValue('just a string')
    const graph = { nodes: [varAssignArrayNode('n1', 'items')], edges: [] }

    const result = await resolveGraphOutputs('org-1', { graph })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(Error)
    expect(result._unsafeUnwrapErr().message).toBe('just a string')
  })
})
