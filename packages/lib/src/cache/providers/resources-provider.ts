// packages/lib/src/cache/providers/resources-provider.ts

import { ResourceRegistryService } from '../../resources/registry/resource-registry-service'
import type { Resource } from '../../resources/registry/types'
import type { CacheProvider } from '../org-cache-provider'

/** Computes the full resource registry for an organization */
export const resourcesProvider: CacheProvider<Resource[]> = {
  async compute(orgId, db) {
    const registry = new ResourceRegistryService(orgId, db)
    return registry.getAll()
  },
}
