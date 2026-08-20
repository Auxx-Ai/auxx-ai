// packages/lib/src/workflow-engine/catalog/__tests__/hydration-policy-pairing.test.ts
//
// The pairing rule: `hydrateGraph` and `dehydrateGraph` MUST run under the same
// policy on both sides of the wire.
//
// This exists because they did not. `workflow-save-provider.tsx` called
// `dehydrateGraph(...)` with no options, so the read-time defaults layer's
// inverse ran and deleted every `node.data` key whose value equalled its
// manifest default — while every server reader hydrated with the layer OFF and
// never put them back. An HTTP node stored as `{desc, title, type, url}` fails
// `httpNodeConfigSchema.safeParse`, and a resource-trigger lost `operation`,
// which drops `deriveTriggerColumns` to the generic `'resource-trigger'` that no
// dispatcher matches — i.e. the workflow silently stops firing.
//
// That layer is now deleted (`hydration-policy.ts` has the epitaph), so the
// specific asymmetry is unrepresentable. The pairing rule outlived it: the
// policy still carries `stripDefaultHandles`, and a caller that dehydrates
// under a different policy than the reader hydrates under is still a bug. These
// tests hold the surviving contract — a canvas round trip loses no authored
// config, and the trigger columns still derive after one.

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

  it('an UNPAIRED dehydrate is still a hazard — the handles, now that the defaults are gone', () => {
    // The surviving half of the rule. `dehydrateGraph`'s own parameter default
    // preserves handles (so a read-modify-write data migration sees stored
    // bytes); `DEHYDRATION_OPTIONS` strips them. A writer that skips the shared
    // policy therefore stores a document a different shape from every other
    // writer's — harmless for handles specifically, because hydration restores
    // them either way, but it is the same class of divergence that cost a row
    // in #1771. Pinned so the asymmetry is visible rather than surprising.
    const { node } = canvasNode('http')
    const hydrated = hydrateGraph(
      {
        nodes: [node],
        edges: [{ id: 'e', source: 'http-1', target: 'http-1' }],
      } as unknown as GraphDocument,
      HYDRATION_OPTIONS
    )

    const unpaired = dehydrateGraph(hydrated)
    const paired = dehydrateGraph(hydrated, DEHYDRATION_OPTIONS)

    expect((unpaired.edges[0] as { sourceHandle?: string }).sourceHandle).toBe('source')
    expect(paired.edges[0]).not.toHaveProperty('sourceHandle')

    // Either way the config survives — that is what the deleted layer broke.
    for (const stored of [unpaired, paired]) {
      expect((stored.nodes[0] as { data: Record<string, unknown> }).data).toHaveProperty('method')
    }
  })

  it('a canvas save keeps every non-default handle', () => {
    // Non-default handles are CONTENT: branch ids, case ids, `loop-start`,
    // `loop-back`, `fail`. 64 of 130 bundled-template edges carry one.
    const { node } = canvasNode('if-else')
    const withBranches = dehydrateGraph(
      hydrateGraph(
        {
          nodes: [node],
          edges: [
            { id: 'e1', source: 'if-else-1', target: 'if-else-1', sourceHandle: 'case_abc' },
            { id: 'e2', source: 'if-else-1', target: 'if-else-1', sourceHandle: 'false' },
            { id: 'e3', source: 'if-else-1', target: 'if-else-1', targetHandle: 'loop-back' },
          ],
        } as unknown as GraphDocument,
        HYDRATION_OPTIONS
      ),
      DEHYDRATION_OPTIONS
    )
    const handles = withBranches.edges.map((e) => (e as { sourceHandle?: string }).sourceHandle)
    expect(handles).toEqual(['case_abc', 'false', undefined])
    expect((withBranches.edges[2] as { targetHandle?: string }).targetHandle).toBe('loop-back')
  })
})
