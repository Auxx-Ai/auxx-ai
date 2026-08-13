// packages/lib/src/workflow-engine/catalog/output-context.ts

import type { Resource } from '../../resources/client'
import type { UnifiedVariable } from '../types/unified-variable'

/**
 * Context an output resolver reads — today's `OutputVariableContext`
 * (apps/web types/output-variables.ts, which now re-exports this) relocated
 * verbatim, so the ~29 pure resolvers move without edits and the four
 * context-reading ones keep reading the same field names (Phase 2 §2).
 *
 * Browser: `computeNodeOutputs` builds it from the resource store. Server
 * (Phase 2 §2): an adapter builds it from the org cache — and must reproduce
 * the resource TIERS, not just fetch: static-registry resources resolve
 * without a cache read, entity-backed ones key by EntityDefinition CUID, and
 * `allResources` needs the same multi-alias entries the front-end store
 * supplies (id / apiSlug / entityType), or relation expansion silently
 * degrades. See `05-resource-model.md` §1.
 */
export interface OutputContext {
  /** The resource this node is bound to, if its config names one. */
  resource?: Resource
  /** Every resource the org can see — relation traversal needs the map. */
  allResources: Resource[]
  /** Resolve an upstream variable by id. undefined ⇒ not computed yet. */
  resolveVariable: (variableId: string) => UnifiedVariable | undefined
}

/**
 * A node type's output resolver: what variables does this node expose
 * downstream, for a given persisted config?
 */
export type OutputResolver<TConfig = unknown> = (
  config: TConfig,
  nodeId: string,
  ctx: OutputContext
) => UnifiedVariable[]

/**
 * Context for nodes whose output variables are derived purely from their own
 * configuration — they resolve no resource and read no upstream variable.
 * Panels that render a definition's outputs inline use this empty one; the
 * canvas builds a real context in `computeNodeOutputs`.
 */
export const staticOutputContext: OutputContext = {
  allResources: [],
  resolveVariable: () => undefined,
}
