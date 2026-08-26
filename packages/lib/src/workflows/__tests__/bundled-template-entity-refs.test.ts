// packages/lib/src/workflows/__tests__/bundled-template-entity-refs.test.ts
//
// The guard that was missing. `templates/order.json` was retired when the native
// `order` system entity shipped (plans/products/08-order-build.md §3.5), and the
// eight ENTITY templates that referenced it were rewritten in the same PR — but the
// bundled WORKFLOW templates were never audited. `order-issue-triage` kept declaring
// `entityTemplateId: "order"`, so `getEntityTemplateById('order')` returned undefined,
// `resolveEntityRefsInGraph` never built a ref for it, and the template installed with
// the literal string `@entity:orders` sitting in three nodes' `resourceType`.
//
// Nothing failed. That is the point: an unresolvable entity ref is silent — the
// installer logs a debug line and moves on. These tests turn it into a red build.
//
// `entity-templates/template-registry.test.ts` is the same idea for the other half.

import { describe, expect, it } from 'vitest'
import { getTemplateById as getEntityTemplateById } from '../../entity-templates/template-registry'
import type { WorkflowGraph } from '../template-graph-transformer'
import { type RequiredEntity, resolveEntityRefsInGraph } from '../template-resolution'
import { FILE_TEMPLATE_ID_PREFIX, FILE_TEMPLATES } from '../templates'

/** Every bundled template paired with its declared entity requirements. */
const TEMPLATES = FILE_TEMPLATES.map((t) => ({
  slug: t.id.replace(FILE_TEMPLATE_ID_PREFIX, ''),
  requiredEntities: (t.requiredEntities ?? []) as RequiredEntity[],
  graph: t.graph as WorkflowGraph,
}))

/** Synthetic, deterministic ids — resolution only cares that a mapping exists. */
function buildMaps(requiredEntities: RequiredEntity[]) {
  const entityIdMap: Record<string, string> = {}
  const fieldIdMap: Record<string, Record<string, string>> = {}
  for (const req of requiredEntities) {
    entityIdMap[req.entityTemplateId] = `def_${req.apiSlug}`
    fieldIdMap[req.entityTemplateId] = Object.fromEntries(
      Object.keys(req.fieldMapping).map((ref) => [ref, `fld_${req.apiSlug}_${ref}`])
    )
  }
  return { entityIdMap, fieldIdMap }
}

describe('bundled workflow templates — declared entities', () => {
  it.each(TEMPLATES)('$slug: every custom entityTemplateId resolves', ({ requiredEntities }) => {
    const custom = requiredEntities.filter((r) => !r.entityTemplateId.startsWith('__system:'))
    for (const req of custom) {
      expect(
        getEntityTemplateById(req.entityTemplateId),
        `entityTemplateId '${req.entityTemplateId}' is not a registered entity template — ` +
          'it was probably retired. A workflow template that names a dead template resolves ' +
          'nothing and installs with its @entity: placeholders intact.'
      ).toBeTruthy()
    }
  })

  it.each(TEMPLATES)('$slug: a custom entity declares the apiSlug it actually has', ({
    requiredEntities,
  }) => {
    for (const req of requiredEntities.filter((r) => !r.entityTemplateId.startsWith('__system:'))) {
      const template = getEntityTemplateById(req.entityTemplateId)
      expect(req.apiSlug).toBe(template?.entity.apiSlug)
    }
  })
})

describe('bundled workflow templates — graph refs resolve', () => {
  // The end-to-end check: run the real resolver over each bundled graph and assert
  // nothing is left behind. This is what would have caught @entity:orders.
  it.each(TEMPLATES)('$slug: no @entity: placeholder survives resolution', ({
    requiredEntities,
    graph,
  }) => {
    const clone = structuredClone(graph)
    const { entityIdMap, fieldIdMap } = buildMaps(requiredEntities)

    const { unresolvedNodes } = resolveEntityRefsInGraph(
      clone,
      requiredEntities,
      entityIdMap,
      fieldIdMap
    )

    // `$comment` lives on the node wrapper, not inside `data`, and the resolver only
    // walks `data` — so serializing just the data is what the installed graph sees.
    const serialized = JSON.stringify(clone.nodes.map((n: { data: unknown }) => n.data))
    expect(serialized).not.toContain('@entity:')
    expect(unresolvedNodes).toEqual([])
  })

  it.each(TEMPLATES)('$slug: every @field: ref is declared in a fieldMapping', ({
    requiredEntities,
    graph,
  }) => {
    const declared = new Set(requiredEntities.flatMap((r) => Object.keys(r.fieldMapping)))
    const refs = new Set(
      Array.from(
        JSON.stringify(graph.nodes.map((n: { data: unknown }) => n.data)).matchAll(
          /@field:([A-Za-z_]\w*)/g
        )
      ).map((m) => m[1]!)
    )
    const undeclared = [...refs].filter((r) => !declared.has(r))
    expect(
      undeclared,
      'a @field: ref with no fieldMapping entry is left verbatim in the installed graph'
    ).toEqual([])
  })
})
