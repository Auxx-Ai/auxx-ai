// packages/lib/src/workflows/graph-edit/branches.ts

/**
 * A node's outgoing branches, as the agent surface reports them — pure,
 * browser-safe.
 *
 * `manifest.connection.branches(config)` is the single source for the handle
 * ids the canvas renders, the engine routes on and edges leave on. Everything
 * here is a thin, TOTAL wrapper over it:
 *
 * - {@link safeBranches} never throws. A derivation is a function of
 *   agent-authored config, so a config-shape mistake can make it blow up
 *   (`if-else` with `cases: []` did exactly that until plan 21 F4), and every
 *   caller here is on a READ path — `validateGraphStructure` runs inside
 *   `readDraft`, so one bad node used to 500 `get_workflow`, `get_node`,
 *   `validate_workflow` AND every mutation at once. A degenerate config must
 *   report as an issue, never as a thrown read.
 * - {@link buildBranchSummaries} joins the derived branches against the graph's
 *   edges so every node read and write can say what a branch is CALLED, what
 *   its address is, and what is already wired to it. Before this, the only way
 *   an agent learned a node's real branch vocabulary was to guess wrong and
 *   read the error message (plan 21 §3.1).
 */

import type { NodeBranch, NodeManifest } from '../../workflow-engine/catalog/types'
import { formatNodeRef } from './refs'
import type { DraftGraph, GraphNode, NodeBranchSummary } from './types'

/**
 * Branch ids that mean "nothing else matched". Mirrors `isFallback` in
 * `workflow-engine/core/workflow-graph-builder.ts` — leaving one of these
 * unwired is a legitimate, common authoring choice, not an oversight.
 */
export const FALLBACK_BRANCH_IDS: ReadonlySet<string> = new Set(['false', 'default', 'unmatched'])

/** The plain output handle every non-branching node exposes. */
export const DEFAULT_SOURCE_HANDLE = 'source'

/** The branches a manifest derives for this config — `[]` on absence OR on throw. */
export function safeBranches(
  manifest: NodeManifest<any> | undefined,
  config: unknown
): NodeBranch[] {
  try {
    return manifest?.connection.branches?.(config) ?? []
  } catch {
    return []
  }
}

/** The handle an edge leaves on, defaulted the way every writer defaults it. */
export function edgeSourceHandle(edge: { sourceHandle?: string | null }): string {
  return edge.sourceHandle ?? DEFAULT_SOURCE_HANDLE
}

/**
 * This node's branches with their current targets, or `undefined` for a node
 * that has none.
 *
 * `undefined` rather than `[]` on purpose: an empty array reads as "this node
 * has branches and none are wired", which is a different and alarming claim
 * about the ~23 single-`source` node types.
 */
export function buildBranchSummaries(
  graph: DraftGraph,
  node: GraphNode,
  manifest: NodeManifest<any> | undefined
): NodeBranchSummary[] | undefined {
  const branches = safeBranches(manifest, node.data)
  if (branches.length === 0) return undefined
  return branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    kind: branch.kind,
    connectedTo: graph.edges
      .filter((edge) => edge.source === node.id && edgeSourceHandle(edge) === branch.id)
      .map((edge) => formatNodeRef(graph.nodes, edge.target)),
  }))
}
