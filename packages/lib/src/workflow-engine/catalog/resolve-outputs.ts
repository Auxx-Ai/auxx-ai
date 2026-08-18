// packages/lib/src/workflow-engine/catalog/resolve-outputs.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { getCachedResources } from '../../cache'
import { NotFoundError } from '../../errors'
import type { UnifiedVariable } from '../types/unified-variable'
import { buildManifestLookup } from './app-manifests'
import { buildOutputContextFromResources } from './build-output-context'
import { buildUpstreamMap, type EdgeMeta, type NodeMeta, topologicalSort } from './graph-vars'
import { getManifest } from './registry'
import type { ManifestLookup } from './types'
import { getNodeIdFromVariableId } from './variable-inference'

const logger = createScopedLogger('workflow-resolve-outputs')

/**
 * The persisted-graph shape output resolution reads: React Flow nodes, engine
 * nodes and agent-authored graphs all satisfy it structurally (same
 * `NodeMeta`/`EdgeMeta` the browser's `useVarStore` graph slice uses). Not the
 * engine's own `WorkflowGraph` (`core/types.ts`, `nodes: any[]` — untyped on
 * purpose because the engine never reads node data) nor the runtime execution
 * graph (`core/workflow-graph-builder.ts`, Map-indexed, built during a run) —
 * both are named `WorkflowGraph` too but neither is the shape a persisted or
 * agent-authored graph arrives in.
 */
export interface WorkflowOutputGraph {
  nodes: NodeMeta[]
  edges: EdgeMeta[]
}

/**
 * Find a variable by id within one node's declared output tree (walking
 * `properties`/`items`). Mirrors the browser's `findVariableInTree`
 * (`store/var-availability.ts`) exactly, so `resolveVariable` — the seam a
 * handful of resolvers (`list`) read to type themselves from an upstream
 * variable — behaves identically on both sides.
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
 * Resolve `nodeIds` in topological order, memoizing each node's outputs so a
 * downstream node's `resolveVariable` reads an upstream node's already-
 * computed result instead of recursing into it — the same shape the browser
 * store's `updateGraph` uses (`use-var-store.ts`), so server and browser
 * produce the same answer node-for-node (Phase 2 §7's parity requirement).
 *
 * `topologicalSort` (`graph-vars.ts`) already filters loop-back edges and
 * terminates even when a hand-authored graph carries a genuine (non-loop)
 * cycle — Kahn's algorithm appends the unresolved remainder once, it never
 * loops forever. The `visited` set below is a second, cheaper-than-trusting
 * guard on top of that: it makes this loop itself cycle-safe by construction
 * (a `nodeId` is processed at most once) even if `topoOrder` ever contained a
 * repeat, per Phase 2 §3's "add a visited-set guard anyway" for graphs with
 * fewer structural guarantees than the canvas.
 *
 * One `allResources` fetch is shared across every node via
 * {@link buildOutputContextFromResources} — the whole point of resolving a
 * batch together instead of calling a single-node resolver in a loop.
 */
function resolveInTopoOrder(
  allResources: Awaited<ReturnType<typeof getCachedResources>>,
  nodes: NodeMeta[],
  edges: EdgeMeta[],
  lookup: ManifestLookup
): Map<string, UnifiedVariable[]> {
  const topoOrder = topologicalSort(nodes, edges)
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const memo = new Map<string, UnifiedVariable[]>()
  const visited = new Set<string>()

  for (const nodeId of topoOrder) {
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    const node = nodeMap.get(nodeId)
    if (!node) continue

    const nodeType: string | undefined = node.data?.type ?? node.type

    // One lookup for both worlds: core types come from the registry, app blocks
    // from a manifest synthesized off their catalog projection. There is no
    // separate app-block arm here on purpose — a second resolution path would
    // be free to drift from the manifest's own `resolveOutputs`, which is the
    // duplication D1 exists to prevent.
    //
    // A positive lookup is the guard: only a block the org actually has
    // installed resolves. Do NOT widen this to "any type containing a colon" —
    // that is `hasProcessor`'s fail-open, and it does not belong here (D8).
    const manifest = nodeType ? lookup(nodeType) : undefined
    if (!manifest?.resolveOutputs) {
      // Not-yet-migrated or unknown type (`NOT_YET_MIGRATED` — `crud`/`find`
      // today): no server-side resolver exists yet. Empty, not an error —
      // same "nothing to report" the four context-reading resolvers give a
      // node with no resource picked yet.
      memo.set(nodeId, [])
      continue
    }

    const resolveVariable = (variableId: string): UnifiedVariable | undefined => {
      const sourceNodeId = getNodeIdFromVariableId(variableId)
      const sourceOutputs = memo.get(sourceNodeId)
      return sourceOutputs ? findVariableInTree(sourceOutputs, variableId) : undefined
    }

    const context = buildOutputContextFromResources(allResources, node.data?.resourceType)
    // A resolver crash (e.g. a legacy node whose persisted data is missing the
    // shape the resolver expects) degrades to "no outputs for this node" — one
    // bad node must not poison resolution for the whole graph.
    try {
      memo.set(nodeId, manifest.resolveOutputs(node.data, nodeId, { ...context, resolveVariable }))
    } catch {
      memo.set(nodeId, [])
    }
  }

  return memo
}

/**
 * The manifest lookup for this graph — the core registry alone when no node
 * could possibly be an app block.
 *
 * A `${appId}:${blockId}` type is the only thing the synthesized half could
 * match, so a graph of purely core nodes must not pay for an `installedApps`
 * cache read. The colon test is a cheap pre-filter, never an authorization
 * decision: the real gate is the positive lookup in `resolveInTopoOrder`.
 */
async function manifestLookupForGraph(orgId: string, nodes: NodeMeta[]): Promise<ManifestLookup> {
  const hasCandidate = nodes.some((n) => {
    const type = n.data?.type ?? n.type
    return typeof type === 'string' && type.includes(':')
  })
  return hasCandidate ? await buildManifestLookup(orgId) : getManifest
}

/**
 * Outputs for one node, given the full graph for upstream resolution.
 *
 * Only walks `nodeId`'s own ancestor set (via `buildUpstreamMap`), not the
 * whole graph — a picker asking about one node shouldn't pay for resolving
 * unrelated branches. `resolveGraphOutputs` is the one to call when every
 * node's outputs are needed; calling this in a loop over every node would
 * re-derive the ancestor set and re-fetch nothing (the cache read is per
 * call) but re-walk the topological order each time — do that with
 * `resolveGraphOutputs` instead.
 */
export async function resolveNodeOutputs(
  orgId: string,
  params: { graph: WorkflowOutputGraph; nodeId: string }
): Promise<Result<UnifiedVariable[], Error>> {
  const { graph, nodeId } = params
  if (!graph.nodes.some((n) => n.id === nodeId)) {
    return err(new NotFoundError(`Node not found in graph: ${nodeId}`))
  }

  const ancestorIds = buildUpstreamMap(graph.edges, graph.nodes).get(nodeId) ?? new Set<string>()
  const relevantIds = new Set([...ancestorIds, nodeId])
  const relevantNodes = graph.nodes.filter((n) => relevantIds.has(n.id))

  const [allResources, lookup] = await Promise.all([
    getCachedResources(orgId),
    manifestLookupForGraph(orgId, relevantNodes),
  ])
  const memo = resolveInTopoOrder(allResources, relevantNodes, graph.edges, lookup)
  return ok(memo.get(nodeId) ?? [])
}

/**
 * Every node's outputs in one pass — one org-cache read, one topological
 * ordering, one memoized walk. What Phase 3's `get_workflow` and the
 * post-mutation resolver call; resolving node-by-node in a loop would re-walk
 * the graph per node.
 */
export async function resolveGraphOutputs(
  orgId: string,
  params: { graph: WorkflowOutputGraph }
): Promise<Result<Map<string, UnifiedVariable[]>, Error>> {
  try {
    const [allResources, lookup] = await Promise.all([
      getCachedResources(orgId),
      manifestLookupForGraph(orgId, params.graph.nodes),
    ])
    const memo = resolveInTopoOrder(allResources, params.graph.nodes, params.graph.edges, lookup)
    return ok(memo)
  } catch (error) {
    // Outputs are ENRICHMENT, not correctness — and every caller already says
    // so: `ops.ts` and `read.ts` guard on `isOk()` and simply carry on without
    // them. But that branch is only reachable through a RETURNED `err`; a
    // throw sails past it. This function has always declared
    // `Result<…, Error>` and never produced one, so both cache reads below it
    // were effectively un-caught:
    //
    //   - `getCachedResources` (Redis + Postgres)
    //   - `manifestLookupForGraph` → `buildManifestLookup` → the installedApps
    //     provider (Redis + Postgres), reached by any graph holding an
    //     `appId:blockId` node
    //
    // `runGraphMutation` calls this BEFORE `persistDraft`, so a blip in either
    // aborted an already-validated, about-to-be-written edit and lost the
    // user's change. Honouring the declared contract is the whole fix; no
    // call site needs to change.
    //
    // Deliberately NOT degrading to an empty lookup: outputs would keep
    // flowing minus the app-block variables, and `checkVariableRefsAgainstOutputs`
    // would then report perfectly valid references as unresolvable — inventing
    // issues is worse than reporting none.
    logger.warn('Output resolution failed — continuing without outputs', {
      orgId,
      nodeCount: params.graph.nodes.length,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
