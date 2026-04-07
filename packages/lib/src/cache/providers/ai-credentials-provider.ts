// packages/lib/src/cache/providers/ai-credentials-provider.ts

import type { CredentialsResponse, ModelType } from '../../ai/providers/types'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Computes non-obfuscated credentials for all configured providers and their models.
 * Returns Record<credentialKey, CredentialsResponse> where credentialKey encodes
 * provider:model:modelType (or provider:__provider__ for provider-level).
 */
export const aiCredentialsProvider: CacheProvider<Record<string, CredentialsResponse>> = {
  async compute(orgId, db) {
    const { ProviderConfigurationService } = await import(
      '../../ai/providers/provider-configuration-service'
    )
    const service = new ProviderConfigurationService(db, orgId, 'system')
    const { configurations } = await service.getConfigurations()
    const credentials: Record<string, CredentialsResponse> = {}

    for (const [provider, config] of Object.entries(configurations)) {
      // Cache provider-level credentials (no model/modelType)
      const providerCreds = await service.getCurrentCredentials(provider, null, null)
      credentials[`${provider}:__provider__`] = providerCreds

      // Cache per-model credentials for each configured model
      for (const model of config.models) {
        const modelCreds = await service.getCurrentCredentials(
          provider,
          model.modelId,
          model.modelType as ModelType
        )
        credentials[`${provider}:${model.modelId}:${model.modelType}`] = modelCreds
      }
    }

    return credentials
  },
}
