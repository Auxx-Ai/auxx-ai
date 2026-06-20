// packages/lib/src/cache/providers/ai-provider-configs-provider.ts

import type { ProviderConfiguration } from '../../ai/providers/types'
import type { CacheProvider } from '../org-cache-provider'

/** Computes all AI provider configurations for the organization */
export const aiProviderConfigsProvider: CacheProvider<Record<string, ProviderConfiguration>> = {
  async compute(orgId, db) {
    // Lazy import to avoid circular dependency at module load time
    const { computeProviderConfigs } = await import('../../ai/providers/config/assemble')
    const result = await computeProviderConfigs({ db, organizationId: orgId, userId: 'system' })
    return result.configurations
  },
}
