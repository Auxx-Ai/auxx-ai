// packages/lib/src/cache/providers/resources-provider.ts

import type { RelationshipConfig } from '@auxx/types/custom-field'
import type { ResourceFieldId } from '@auxx/types/field'
import type { ResourceField } from '../../resources/registry/field-types'
import { computeAllResources } from '../../resources/registry/resource-registry-compute'
import type { Resource } from '../../resources/registry/types'
import { ArrayAccessor } from '../accessors'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Resolve static `inverseResourceFieldId` values (e.g., 'contact:tickets')
 * to actual CUID-based ResourceFieldIds using the full resource list.
 *
 * Runs once during cache compute, not per-request.
 */
function resolveInverseReferences(resources: Resource[]): Resource[] {
  // Build lookup: 'entityType:fieldKey' → actual resourceFieldId
  const fieldKeyToResourceFieldId = new Map<string, ResourceFieldId>()
  for (const resource of resources) {
    const entityType = resource.entityType ?? resource.id
    for (const field of resource.fields) {
      if (field.resourceFieldId) {
        fieldKeyToResourceFieldId.set(`${entityType}:${field.key}`, field.resourceFieldId)
      }
    }
  }

  // Resolve all static inverseResourceFieldIds
  for (const resource of resources) {
    for (const field of resource.fields) {
      const relationship = field.relationship as RelationshipConfig | undefined
      if (!relationship?.inverseResourceFieldId) continue

      const ref = relationship.inverseResourceFieldId
      // Already a real CUID-based ResourceFieldId (both parts are long IDs) — skip
      const [left, right] = (ref as string).split(':')
      if (left.length > 20 && right.length > 20) continue

      // Static format like 'contact:tickets' — resolve to actual resourceFieldId
      const resolved = fieldKeyToResourceFieldId.get(ref as string)
      if (resolved) {
        relationship.inverseResourceFieldId = resolved
      }
    }
  }

  return resources
}

/** Computes the full resource registry for an organization */
export const resourcesProvider: CacheProvider<Resource[]> = {
  async compute(orgId, db) {
    const resources = await computeAllResources(orgId, db)
    return resolveInverseReferences(resources)
  },

  createAccessor(dataFn: () => Promise<Resource[]>) {
    const accessor = new ArrayAccessor(dataFn)

    return Object.assign(accessor, {
      async bySlug(slug: string): Promise<Resource | null> {
        const data = await dataFn()
        return data.find((r) => r.apiSlug === slug) ?? null
      },
      async fieldsFor(resourceId: string): Promise<ResourceField[]> {
        const data = await dataFn()
        return data.find((r) => r.id === resourceId)?.fields ?? []
      },
    })
  },
}
