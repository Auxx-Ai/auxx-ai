// packages/lib/src/workflow-engine/nodes/utils/canonical-resource.ts

import { findCachedResource } from '../../../cache'

/**
 * Resolve a configured `resourceType` — an id, an `entityType` slug, or an
 * `apiSlug`, since `findCachedResource` matches any of the three — to the
 * ONE canonical identity every downstream lane has to agree on: the cached
 * resource's own id.
 *
 * From here on there is exactly ONE identity for this resource. The
 * configured `resourceType` is only a lookup key, and every lane below
 * (query building, entity vs. system-resource branching, output keying) has
 * to agree on the resolved value or they disagree by construction.
 *
 * For an entity-definition-backed type (contact, ticket, part, order, …)
 * that id IS the `EntityDefinition` cuid, which is what routes it down the
 * custom-entity lane; for a static system table it is the `TableId`
 * ('thread', 'message', 'kb').
 *
 * Throws the same "Unknown resource type" error on a miss that find.ts has
 * always thrown. Callers that need the miss routed through their own
 * error-handling (e.g. crud's `error_strategy`) must call this from inside
 * their own try/catch — this helper does not catch anything itself.
 */
export async function resolveCanonicalResource(organizationId: string, resourceType: string) {
  const resource = await findCachedResource(organizationId, resourceType)
  if (!resource) {
    throw new Error(`Unknown resource type: ${resourceType}`)
  }
  return resource
}
