// packages/lib/src/workflow-engine/catalog/output-context.ts

import type { Resource } from '../../resources/client'
import type { UnifiedVariable } from '../types/unified-variable'

/**
 * Context an output resolver reads — today's `OutputVariableContext`
 * (apps/web types/output-variables.ts, which now re-exports this) relocated
 * verbatim, so the ~29 pure resolvers move without edits and the four
 * context-reading ones keep reading the same field names (Phase 2 §2).
 *
 * Browser: `computeNodeOutputs` builds it from the resource store, which
 * stores each resource under multiple alias keys (id / apiSlug / entityType)
 * for its own map lookups. That aliasing never reaches a resolver: every
 * context-reading resolver (`crud`, `find`, `resource-trigger`) immediately
 * re-keys `allResources` by `r.id` alone
 * (`new Map(allResources.map((r) => [r.id, r]))`) before doing anything with
 * it, so a multi-alias map is dead weight by the time it would matter.
 *
 * Server (`build-output-context.ts`): `buildOutputContext(orgId, params)`
 * builds this straight from `getCachedResources(orgId)` — no alias map, no
 * per-tier branching. `getCachedResources` already covers both resource
 * tiers (static-registry and entity-backed; `resource-registry-service.ts`'s
 * `getAll()` concatenates them), and `resource` is looked up with the same
 * `id | entityType | apiSlug` match `findCachedResource` uses, which already
 * matches whatever key a node's `resourceType` config holds.
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
