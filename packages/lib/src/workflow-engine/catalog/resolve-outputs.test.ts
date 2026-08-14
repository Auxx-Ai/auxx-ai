// packages/lib/src/workflow-engine/catalog/resolve-outputs.test.ts

import { describe, expect, it, vi } from 'vitest'
import type { Resource } from '../../resources/client'
import { BaseType } from '../core/types'

// Partial mock — the cache barrel is imported by half of lib; replacing it wholesale
// dies at collection (see `resource-trigger-base.test.ts`). Only the one read this
// module makes is stubbed.
const getCachedResources = vi.fn()
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
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
