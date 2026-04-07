// packages/lib/src/cache/providers/ai-default-models-provider.ts

import type { CachedSystemModelDefault } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

/** Computes all system model defaults for the organization, keyed by modelType */
export const aiDefaultModelsProvider: CacheProvider<Record<string, CachedSystemModelDefault>> = {
  async compute(orgId, db) {
    const { SystemModelService } = await import('../../ai/providers/system-model-service')
    const service = new SystemModelService(db, orgId)
    const defaults = await service.getAllDefaults()

    return Object.fromEntries(
      defaults.map((d) => [
        d.modelType,
        {
          id: d.id,
          organizationId: d.organizationId,
          modelType: d.modelType,
          provider: d.provider,
          model: d.model,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        },
      ])
    )
  },
}
