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
    const { computeProviderConfigs } = await import('../../ai/providers/config/assemble')
    const { loadProviderCredentialContext, resolveCredentials } = await import(
      '../../ai/providers/config/runtime-credentials'
    )
    const ctx = { db, organizationId: orgId, userId: 'system' }
    const { configurations } = await computeProviderConfigs(ctx)
    const credentials: Record<string, CredentialsResponse> = {}

    for (const [provider, config] of Object.entries(configurations)) {
      // Resolve the per-provider invariants (config + BYO default key) once, reusing the
      // already-assembled `config` — every model below threads it instead of re-assembling.
      const providerCtx = await loadProviderCredentialContext(ctx, provider, config)

      // Cache provider-level credentials (no model/modelType)
      credentials[`${provider}:__provider__`] = await resolveCredentials(
        ctx,
        provider,
        null,
        null,
        providerCtx
      )

      // Cache per-model credentials for each configured model
      for (const model of config.models) {
        credentials[`${provider}:${model.modelId}:${model.modelType}`] = await resolveCredentials(
          ctx,
          provider,
          model.modelId,
          model.modelType as ModelType,
          providerCtx
        )
      }
    }

    return credentials
  },
}
