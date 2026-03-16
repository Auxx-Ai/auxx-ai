// packages/lib/src/resources/registry/resource-registry-compute.ts

import type { Database } from '@auxx/database'
import { ResourceRegistryService } from './resource-registry-service'
import type { Resource } from './types'

/**
 * Raw computation of all resources for an org.
 * Directly queries DB — no caching.
 * Used by the cache provider as the compute function.
 */
export async function computeAllResources(orgId: string, db: Database): Promise<Resource[]> {
  const registry = new ResourceRegistryService(orgId, db)
  return registry.getAll()
}
