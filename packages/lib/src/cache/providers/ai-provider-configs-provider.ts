// packages/lib/src/cache/providers/ai-provider-configs-provider.ts

import type { ProviderConfiguration } from '../../ai/providers/types'
import type { CacheProvider } from '../org-cache-provider'

/** Computes all AI provider configurations for the organization */
export const aiProviderConfigsProvider: CacheProvider<Record<string, ProviderConfiguration>> = {
  async compute(orgId, db) {
    // Lazy import to avoid circular dependency at module load time
    const { ProviderConfigurationService } = await import(
      '../../ai/providers/provider-configuration-service'
    )
    const service = new ProviderConfigurationService(db, orgId, 'system')
    const result = await service.getConfigurations()
    return result.configurations
  },
}
