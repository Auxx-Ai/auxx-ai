// packages/lib/src/workflow-engine/catalog/__tests__/hydration-policy-pairing.test.ts
//
// The pairing rule: `hydrateGraph` and `dehydrateGraph` MUST run under the same
// `skipDefaults` policy on both sides of the wire.
//
// This exists because they did not. `workflow-save-provider.tsx` called
// `dehydrateGraph(...)` with no options, so `skipDefaults` defaulted to OFF and
// the strip deleted every `node.data` key whose value equalled its manifest
// default — while every server reader hydrates with `skipDefaults: true` and
// never put them back. An HTTP node stored as `{desc, title, type, url}` fails
// `httpNodeConfigSchema.safeParse` (`method`/`body`/`authorization` have no zod
// default), and a resource-trigger lost `operation`, which drops
// `deriveTriggerColumns` to the generic `'resource-trigger'` that no dispatcher
// matches — i.e. the workflow silently stops firing.
import { describe, expect, it } from 'vitest'
import { deriveTriggerColumns } from '../derive-trigger'
import { dehydrateGraph, type GraphDocument, hydrateGraph } from '../graph-hydration'
import { DEHYDRATION_OPTIONS, HYDRATION_OPTIONS } from '../hydration-policy'
import { getManifest } from '../registry'

/** Keys a stored document is allowed to lose — dead, derived, or canvas-only. */
const DROPPABLE = new Set(['isValid', 'errors', 'outputVariables', 'selected', 'id', 'description'])

const canvasNode = (type: string, extra: Record<string, unknown> = {}) => {
  const manifest = getManifest(type as never)
  if (!manifest) throw new Error(`no manifest for ${type}`)
  const data = { ...(manifest.defaultData() as Record<string, unknown>), type, ...extra }
  return { node: { id: `${type}-1`, type: 'standard', position: { x: 0, y: 0 }, data }, data }
}

/** Exactly what the builder does: hydrate on load, dehydrate on save. */
const saveRoundTrip = (node: unknown): GraphDocument => {
  const loaded = hydrateGraph(
    { nodes: [node], edges: [] } as unknown as GraphDocument,
    HYDRATION_OPTIONS
  )
  return dehydrateGraph(loaded, DEHYDRATION_OPTIONS)
}

describe('hydrate/dehydrate policy pairing', () => {
  const types = ['http', 'resource-trigger', 'scheduled', 'wait', 'ai', 'crud', 'answer', 'end']

  it.each(types)('a canvas save of a default-configured %s loses no authored config', (type) => {
    const { node, data } = canvasNode(type)
    const stored = saveRoundTrip(node)
    const readBack = hydrateGraph(stored, HYDRATION_OPTIONS)
    const survived = (readBack.nodes[0] as { data: Record<string, unknown> }).data

    const lost = Object.keys(data).filter(
      (k) => !(k in survived) && !k.startsWith('_') && !DROPPABLE.has(k)
    )
    expect(lost, `${type} lost config through a save`).toEqual([])
  })

  it('a resource-trigger still derives its trigger columns after a save', () => {
    const { node } = canvasNode('resource-trigger', { entityDefinitionId: 'contact' })

    const before = deriveTriggerColumns([node] as never)
    const after = deriveTriggerColumns(saveRoundTrip(node).nodes as never)

    // The failure mode: `{ triggerType: 'resource-trigger' }` with no entity id,
    // which no dispatcher matches — the workflow stops firing, silently.
    expect(after).toEqual(before)
    expect(after).toMatchObject({ triggerType: 'created', entityDefinitionId: 'contact' })
  })

  it('MISMATCHED policies are what caused the loss — pinned so the hazard stays visible', () => {
    const { node } = canvasNode('http')

    // Browser dehydrating with defaults ON, server reading with them OFF.
    const mismatched = dehydrateGraph(
      hydrateGraph({ nodes: [node], edges: [] } as never),
      undefined
    )
    const asServerSeesIt = hydrateGraph(mismatched, HYDRATION_OPTIONS)
    const data = (asServerSeesIt.nodes[0] as { data: Record<string, unknown> }).data

    expect(data).not.toHaveProperty('method')
    expect(data).not.toHaveProperty('body')

    // ...and the paired policy keeps them.
    const paired = hydrateGraph(saveRoundTrip(node), HYDRATION_OPTIONS)
    expect((paired.nodes[0] as { data: Record<string, unknown> }).data).toHaveProperty('method')
  })
})
