// apps/web/src/components/workflow/parity/output-resolution-parity.test.ts

import { buildOutputContextFromResources } from '@auxx/lib/workflow-engine/catalog/build-output-context'
import {
  resolveGraphOutputs,
  type WorkflowOutputGraph,
} from '@auxx/lib/workflow-engine/catalog/resolve-outputs'
import {
  BaseType,
  type EdgeMeta,
  getNodeIdFromVariableId,
  listManifests,
  NOT_YET_MIGRATED,
  type NodeMeta,
  type Resource,
  type ResourceField,
  topologicalSort,
  type UnifiedVariable,
} from '@auxx/lib/workflow-engine/client'
import { describe, expect, it, vi } from 'vitest'
import { NodeType } from '~/components/workflow/types/node-types'
import { BUILDER_NODE_DEFINITIONS, CONFIG_VARIANTS } from './node-definitions'

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 OUTPUT-RESOLUTION PARITY — BROWSER VS SERVER
//
// Phase 2 landed ONE contract for "what does this node advertise downstream":
// a manifest's `resolveOutputs(config, nodeId, context)`. The browser reaches
// it through `NodeDefinition.outputVariables` (`define-from-manifest.ts`:
// `outputVariables: parts.outputVariables ?? manifest.resolveOutputs`); the
// server reaches it through `resolveGraphOutputs`/`resolveNodeOutputs`
// (`catalog/resolve-outputs.ts`). This suite is what turns "one contract, two
// callers" from a claim into a fact: it builds one graph, resolves it through
// BOTH entry points, and asserts the trees come out identical, node for node.
//
// It deliberately does NOT call `computeNodeOutputs`
// (`store/var-availability.ts`) — that function reads `unifiedNodeRegistry`,
// which imports every node's React component and panel and drags the whole
// builder UI tree into the test process for no benefit. `BUILDER_NODE_DEFINITIONS`
// (`node-definitions.ts`) imports each node's `schema.ts` directly — zod plus
// the node's own types, nothing else — and IS the manifest resolver for every
// migrated type (same `??` fallback above), so calling
// `definition.outputVariables(...)` on it exercises exactly the function the
// canvas would call, without the React weight.
//
// The browser-side resolution loop below (`resolveBrowserOutputs`) mirrors
// `resolve-outputs.ts`'s private `resolveInTopoOrder` line for line: same
// `topologicalSort`, same `buildOutputContextFromResources`, same
// `getNodeIdFromVariableId`-keyed `resolveVariable` memo — all imported from
// the shared lib, not reimplemented. The only thing that differs between the
// two loops is WHERE each node's resolver function comes from
// (`BUILDER_NODE_DEFINITIONS` vs `getManifest(...).resolveOutputs`). For the
// 20 migrated types those are the SAME function reference today (no node here
// overrides `outputVariables` on the web side — see the `defineFromManifest`
// call sites), so this suite is really asserting that the two ORCHESTRATIONS
// (graph walk + context assembly) agree, not that two independently written
// resolvers happen to. A future web-side override, or any divergence in how
// the two loops assemble context, is exactly what this catches.
// ═══════════════════════════════════════════════════════════════════════════

// Partial mock of the cache barrel's narrow submodule. `resolve-outputs.ts`
// reads resources through `getCachedResources` (`../../cache` → re-exported
// from `./org-cache-helpers`, `cache/index.ts:89`), so mocking THIS module
// intercepts the barrel without replacing it wholesale — a full-barrel mock
// dies at vitest collection as the import graph grows (working reference:
// `packages/lib/src/workflow-engine/nodes/triggers/resource-trigger-base.test.ts:20-27`).
//
// `vi.hoisted` (not a plain top-level `const`) because `./node-definitions`
// statically imports every node's `schema.ts`, several of which import
// `@auxx/lib/workflow-engine/client` themselves — so the mocked module can be
// required, and this factory invoked, before a plain `const` below it would
// have been assigned.
const getCachedResources = vi.hoisted(() => vi.fn())

vi.mock('@auxx/lib/cache/org-cache-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/lib/cache/org-cache-helpers')>()),
  getCachedResources,
}))

/**
 * `listManifests()` (the same source `catalog-coverage.test.ts` asserts is
 * exhaustive against the builder's `NodeType` enum) is what defines
 * "migrated" below, so migrating a type pulls it into `MIGRATED_TYPES` and
 * this suite's fixture graph automatically — `crud` and `find` (the last
 * wave-1 types) included, now that both have catalog manifests.
 */
const MIGRATED_TYPES = new Set(listManifests().map((manifest) => manifest.id))

function field(overrides: { id: string; key: string; label: string }): ResourceField {
  return {
    ...overrides,
    type: BaseType.STRING,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: true,
    },
  } as unknown as ResourceField
}

/**
 * A custom-entity resource carrying real fields. `resource-trigger`'s
 * resolver (`getResourceTriggerOutputVariables`) reads `context.resource.fields`
 * directly — NOT the static system-resource registry, and NOT anything keyed
 * off `entityDefinitionId` alone — so a fixture `Resource` with an empty
 * `fields` array would make both sides resolve to nothing and the comparison
 * would pass vacuously.
 */
const FIXTURE_RESOURCE: Resource = {
  type: 'custom',
  id: 'entity_vendor',
  label: 'Vendor',
  plural: 'Vendors',
  icon: 'box',
  color: 'blue',
  isVisible: true,
  entityType: 'entity_vendor',
  apiSlug: 'vendors',
  entityDefinitionId: 'entity_vendor',
  organizationId: 'org-parity-test',
  fields: [
    field({ id: 'status', key: 'status', label: 'Status' }),
    field({ id: 'email', key: 'email', label: 'Email' }),
  ],
  display: {
    primaryDisplayField: null,
    secondaryDisplayField: null,
    avatarField: null,
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },
}

const FIXTURE_RESOURCES: Resource[] = [FIXTURE_RESOURCE]
getCachedResources.mockResolvedValue(FIXTURE_RESOURCES)

const nodeIdFor = (type: string) => `${type}-node`

const varAssignArrayVariant = CONFIG_VARIANTS[NodeType.VAR_ASSIGN]?.find(
  (variant) => variant.label === 'named array variable'
)
if (!varAssignArrayVariant) {
  throw new Error('expected a "named array variable" CONFIG_VARIANTS entry for var-assign')
}

/**
 * Per-type data overrides layered onto `manifest.defaultData()`.
 *
 * `var-assign` and `list` are wired into one upstream→downstream edge below
 * so the suite exercises `resolveVariable` (a config field pointing at
 * another node's advertised output) instead of every node resolving in
 * isolation — the default `list` (`inputList: ''`) and default `var-assign`
 * (an unnamed variable) both advertise nothing at all, which would make THAT
 * pair's comparison vacuous the same way an unresolved `resource-trigger`
 * would be. `resource-trigger` gets its `resourceType` pointed at
 * `FIXTURE_RESOURCE` for the same reason.
 */
const NODE_DATA_OVERRIDES: Record<string, Record<string, unknown>> = {
  [NodeType.VAR_ASSIGN]: varAssignArrayVariant.data,
  [NodeType.LIST]: { inputList: `{{${nodeIdFor(NodeType.VAR_ASSIGN)}.myList}}` },
  [NodeType.RESOURCE_TRIGGER]: { resourceType: FIXTURE_RESOURCE.id },
  // Context-reading resolvers, same as resource-trigger above — the default
  // `resourceType: 'contact'` doesn't match anything in `FIXTURE_RESOURCES`,
  // which would make both sides resolve to `[]` and the comparison vacuous.
  [NodeType.FIND]: { resourceType: FIXTURE_RESOURCE.id },
  [NodeType.CRUD]: { resourceType: FIXTURE_RESOURCE.id },
}

const FIXTURE_NODES: NodeMeta[] = listManifests().map((manifest) => {
  const builderEntry = BUILDER_NODE_DEFINITIONS.find((entry) => entry.nodeType === manifest.id)
  if (!builderEntry) {
    throw new Error(
      `"${manifest.id}" is registered in the lib catalog but has no BUILDER_NODE_DEFINITIONS entry`
    )
  }
  const nodeId = nodeIdFor(manifest.id)
  return {
    id: nodeId,
    type: manifest.id,
    data: {
      id: nodeId,
      type: manifest.id,
      title: manifest.displayName,
      ...builderEntry.definition.defaultData,
      ...NODE_DATA_OVERRIDES[manifest.id],
    },
  }
})

const FIXTURE_EDGES: EdgeMeta[] = [
  {
    id: 'e-var-assign-to-list',
    source: nodeIdFor(NodeType.VAR_ASSIGN),
    target: nodeIdFor(NodeType.LIST),
  },
]

const FIXTURE_GRAPH: WorkflowOutputGraph = { nodes: FIXTURE_NODES, edges: FIXTURE_EDGES }

/**
 * Walks `properties`/`items` to find a variable by its full-path id. Mirrors
 * `resolve-outputs.ts`'s private `findVariableInTree`, itself a server-side
 * mirror of the browser's `store/var-availability.ts:findVariableInTree` — the
 * same tree shape, walked the same way, on both sides of this suite.
 */
function findVariableInTree(
  variables: UnifiedVariable[],
  targetId: string
): UnifiedVariable | undefined {
  for (const variable of variables) {
    if (variable.id === targetId) return variable
    if (variable.properties) {
      for (const prop of Object.values(variable.properties)) {
        const found = findVariableInTree([prop], targetId)
        if (found) return found
      }
    }
    if (variable.items) {
      const found = findVariableInTree([variable.items], targetId)
      if (found) return found
    }
  }
  return undefined
}

/**
 * The browser-side counterpart to `resolve-outputs.ts`'s `resolveInTopoOrder`:
 * same topological walk (`topologicalSort`), same context assembly
 * (`buildOutputContextFromResources`), same upstream-variable memo keyed by
 * `getNodeIdFromVariableId` — all imported from the shared lib rather than
 * reimplemented. The one difference is the resolver source: this reads
 * `BUILDER_NODE_DEFINITIONS[...].definition.outputVariables` where the server
 * reads `getManifest(...).resolveOutputs`.
 */
function resolveBrowserOutputs(
  nodes: NodeMeta[],
  edges: EdgeMeta[],
  allResources: Resource[]
): Map<string, UnifiedVariable[]> {
  const order = topologicalSort(nodes, edges)
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const memo = new Map<string, UnifiedVariable[]>()

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId)
    if (!node) continue

    const nodeType: string | undefined = node.data?.type ?? node.type
    const builderEntry = BUILDER_NODE_DEFINITIONS.find((entry) => entry.nodeType === nodeType)
    if (!builderEntry) {
      memo.set(nodeId, [])
      continue
    }

    const resolveVariable = (variableId: string): UnifiedVariable | undefined => {
      const sourceNodeId = getNodeIdFromVariableId(variableId)
      const sourceOutputs = memo.get(sourceNodeId)
      return sourceOutputs ? findVariableInTree(sourceOutputs, variableId) : undefined
    }

    const context = buildOutputContextFromResources(allResources, node.data?.resourceType)
    memo.set(
      nodeId,
      builderEntry.definition.outputVariables(node.data, nodeId, { ...context, resolveVariable })
    )
  }

  return memo
}

/** Deep-sorts a variable tree's map-like slots so array order can't fail the diff. */
function sortVariableTree(variable: UnifiedVariable): UnifiedVariable {
  const sorted: UnifiedVariable = { ...variable }
  if (variable.properties) {
    sorted.properties = Object.fromEntries(
      Object.entries(variable.properties).map(([key, prop]) => [key, sortVariableTree(prop)])
    )
  }
  if (variable.items) {
    sorted.items = sortVariableTree(variable.items)
  }
  return sorted
}

/** Order-independent, full-tree-comparable form of a node's advertised outputs. */
function sortedVariables(variables: UnifiedVariable[]): UnifiedVariable[] {
  return variables.map(sortVariableTree).sort((a, b) => a.id.localeCompare(b.id))
}

describe('output resolution parity: browser vs server', () => {
  const orgId = 'org-parity-test'

  it('crud and find are migrated — not left on NOT_YET_MIGRATED nor missing a manifest', () => {
    expect(NOT_YET_MIGRATED).not.toEqual(expect.arrayContaining(['crud', 'find']))
    expect(MIGRATED_TYPES.has('crud')).toBe(true)
    expect(MIGRATED_TYPES.has('find')).toBe(true)
  })

  it('resolves an identical output-variable tree on both sides for every migrated node type', async () => {
    const browserResult = resolveBrowserOutputs(
      FIXTURE_GRAPH.nodes,
      FIXTURE_GRAPH.edges,
      FIXTURE_RESOURCES
    )

    const serverResultOrErr = await resolveGraphOutputs(orgId, { graph: FIXTURE_GRAPH })
    if (serverResultOrErr.isErr()) throw serverResultOrErr.error
    const serverResult = serverResultOrErr.value

    const comparedTypes = new Set<string>()
    for (const node of FIXTURE_GRAPH.nodes) {
      const nodeType = node.data.type as string
      comparedTypes.add(nodeType)

      const browserVars = sortedVariables(browserResult.get(node.id) ?? [])
      const serverVars = sortedVariables(serverResult.get(node.id) ?? [])
      expect(serverVars, `mismatch for node type "${nodeType}" (node id: ${node.id})`).toEqual(
        browserVars
      )
    }

    // The loud-failure guard: every migrated type must actually have been
    // compared above. A suite that quietly covers 3 of 20 is worse than none —
    // this fails the moment a type is added to the fixture graph without being
    // added to `listManifests()`'s coverage (impossible, since the fixture is
    // BUILT from `listManifests()`) or, more realistically, if a future refactor
    // narrows the fixture without updating this assertion.
    expect(comparedTypes).toEqual(MIGRATED_TYPES)
  })

  it('list infers its result type through resolveVariable, not a bare ARRAY fallback', () => {
    const browserResult = resolveBrowserOutputs(
      FIXTURE_GRAPH.nodes,
      FIXTURE_GRAPH.edges,
      FIXTURE_RESOURCES
    )
    const listNodeId = nodeIdFor(NodeType.LIST)
    const result = (browserResult.get(listNodeId) ?? []).find(
      (v) => v.id === `${listNodeId}.result`
    )

    expect(result?.type).toBe(BaseType.ARRAY)
    expect(result?.items?.type).toBe(BaseType.STRING)
  })

  it('resource-trigger advertises the fixture resource fields, not an empty fallback', () => {
    const browserResult = resolveBrowserOutputs(
      FIXTURE_GRAPH.nodes,
      FIXTURE_GRAPH.edges,
      FIXTURE_RESOURCES
    )
    const triggerOutputs = browserResult.get(nodeIdFor(NodeType.RESOURCE_TRIGGER)) ?? []

    expect(triggerOutputs.length).toBeGreaterThan(0)
  })
})
