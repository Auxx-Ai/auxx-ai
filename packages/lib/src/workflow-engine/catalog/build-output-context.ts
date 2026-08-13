// packages/lib/src/workflow-engine/catalog/build-output-context.ts

import { getCachedResources } from '../../cache'
import type { Resource } from '../../resources/client'
import type { OutputContext } from './output-context'

/**
 * Find the resource a node's config names, from an already-fetched resource
 * list. Same three-key match as `findCachedResource` (`org-cache-helpers.ts`)
 * — id, `entityType`, or `apiSlug` — because a node's `resourceType` value can
 * be any of the three depending on when the node was authored (system slug,
 * apiSlug, or an EntityDefinition CUID). Inlined rather than calling
 * `findCachedResource` so a full-graph caller can share one `allResources`
 * fetch across every node instead of paying a cache read each (see
 * {@link buildOutputContextFromResources}'s caller in `resolve-outputs.ts`).
 */
function findResource(allResources: Resource[], key: string): Resource | undefined {
  return allResources.find((r) => r.id === key || r.entityType === key || r.apiSlug === key)
}

/**
 * Assemble an {@link OutputContext} from an already-fetched resource list.
 *
 * Split out from {@link buildOutputContext} so a caller resolving many nodes
 * in one request (`resolveGraphOutputs`) fetches `allResources` once and
 * builds one context per node from the same array, instead of re-hitting the
 * org cache per node.
 *
 * `resolveVariable` always defaults to "nothing resolved" here — it depends
 * on the request's upstream graph, which this function has no visibility
 * into. Callers that need real upstream resolution (`resolveNodeOutputs`,
 * `resolveGraphOutputs`) overwrite it once they have the graph in hand.
 */
export function buildOutputContextFromResources(
  allResources: Resource[],
  resourceType?: string
): OutputContext {
  return {
    resource: resourceType ? findResource(allResources, resourceType) : undefined,
    allResources,
    resolveVariable: () => undefined,
  }
}

/**
 * Assemble the server-side {@link OutputContext} an output resolver reads —
 * the server counterpart to the browser's `buildOutputContextFromStore`
 * (`store/var-availability.ts`), sourced from the org cache instead of the
 * resource store.
 *
 * `orgId` first, not `db`: every read here goes through `@auxx/lib/cache`
 * (`getCachedResources`), which owns its own DB access and population — there
 * is no query for this function to run against a caller-supplied `db`. This
 * follows the org-cache helpers' own convention (`findCachedResource(orgId,
 * key)`, `getCachedResourceFields(orgId, resourceId)`) rather than the module
 * guide's general "db first" rule, which is written for functions that query
 * `db` directly; a cache-only assembly function has no `db` to accept.
 *
 * `resourceType` is the resource-picker value a node's config names (e.g.
 * `resourceTrigger.resourceType`) — resolved the same way the browser's store
 * does (`resources.get(data.resourceType)`). Absent or unresolved ⇒
 * `resource: undefined`, a valid "nothing picked yet" state (see
 * `resource-trigger.ts`'s empty-array short-circuit for an unset resource),
 * never an error — so this never throws for a missing resource.
 *
 * Single-node convenience over {@link buildOutputContextFromResources} — use
 * that directly (with one shared `allResources` fetch) when resolving more
 * than one node so the org cache is hit once for the whole request, not once
 * per node.
 */
export async function buildOutputContext(
  orgId: string,
  params: { resourceType?: string }
): Promise<OutputContext> {
  const allResources = await getCachedResources(orgId)
  return buildOutputContextFromResources(allResources, params.resourceType)
}
