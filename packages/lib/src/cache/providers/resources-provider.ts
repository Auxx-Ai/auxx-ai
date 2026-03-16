// packages/lib/src/cache/providers/resources-provider.ts

import type { ResourceField } from '../../resources/registry/field-types'
import { computeAllResources } from '../../resources/registry/resource-registry-compute'
import type { Resource } from '../../resources/registry/types'
import { ArrayAccessor } from '../accessors'
import type { CacheProvider } from '../org-cache-provider'

/** Computes the full resource registry for an organization */
export const resourcesProvider: CacheProvider<Resource[]> = {
  async compute(orgId, db) {
    return computeAllResources(orgId, db)
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
