// packages/lib/src/ai/providers/config/cache.ts

import { projectCredentialForEdit } from '@auxx/credentials/crypto'
import { getOrgCache } from '../../../cache/singletons'
import { createScopedLogger } from '../../../logger'
import { ProviderRegistry } from '../provider-registry'
import {
  type CredentialsResponse,
  ModelType,
  type ProviderConfiguration,
  ProviderConfigurationError,
  type ProviderConfigurations,
} from '../types'
import { getSortedProviders } from '../utils'
import { type AiProviderCtx, isProviderLimitedUseBlocked } from './context'
import { isOrgLimitedUseGated } from './limited-use'
import { resolveCredentials } from './runtime-credentials'

const logger = createScopedLogger('ai-provider-config-cache')

/**
 * Cache layer — the public read API for AI provider configuration. Reads from OrgCache
 * (4-stage: local → Redis hash → Redis data → compute) and never touches the DB directly,
 * except as a miss-fallback to the compute layer's `resolveCredentials`.
 */

/**
 * All provider configurations for the org, from the `aiProviderConfigs` cache key.
 *
 * Limited-Use-blocked providers are dropped HERE rather than in the compute layer, so the
 * cached blob stays the full truth and the gate is evaluated against the org's current
 * state on every read. That means connecting or disconnecting a Google channel, or toggling
 * `unrestrictedAiProviders`, takes effect immediately — no `aiProviderConfigs` invalidation
 * to get wrong, and no stale blob that fails open.
 */
export async function getProviderConfigs(ctx: AiProviderCtx): Promise<ProviderConfigurations> {
  try {
    const configurations = await getOrgCache().get(ctx.organizationId, 'aiProviderConfigs')
    const gated = await isOrgLimitedUseGated(ctx.organizationId)
    if (!gated) return { organizationId: ctx.organizationId, configurations }

    const allowed: typeof configurations = {}
    for (const [provider, config] of Object.entries(configurations)) {
      if (!isProviderLimitedUseBlocked(provider, gated)) allowed[provider] = config
    }
    return { organizationId: ctx.organizationId, configurations: allowed }
  } catch (error) {
    logger.error('Failed to get provider configurations', {
      organizationId: ctx.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new ProviderConfigurationError(
      'Failed to retrieve provider configurations',
      'all',
      'CONFIGURATIONS_RETRIEVAL_FAILED'
    )
  }
}

/** Configuration for a single provider, sliced from the cached `aiProviderConfigs` map. */
export async function getProviderConfig(
  ctx: AiProviderCtx,
  provider: string
): Promise<ProviderConfiguration> {
  const configurations = await getOrgCache().get(ctx.organizationId, 'aiProviderConfigs')
  const config = configurations[provider]
  if (!config) {
    throw new ProviderConfigurationError(
      `Provider '${provider}' not found in configurations`,
      provider,
      'PROVIDER_NOT_FOUND'
    )
  }
  // A Limited-Use-blocked provider reads as absent rather than as a distinct error, so
  // callers treat it exactly like an unconfigured provider. `createClient` is what
  // produces the explicit LIMITED_USE_BLOCKED failure if something calls it anyway.
  if (isProviderLimitedUseBlocked(provider, await isOrgLimitedUseGated(ctx.organizationId))) {
    throw new ProviderConfigurationError(
      `Provider '${provider}' not found in configurations`,
      provider,
      'PROVIDER_NOT_FOUND'
    )
  }
  return config
}

/**
 * Credentials for a provider or model, from the `aiCredentials` cache key (keyed by
 * provider:model:modelType, or provider:__provider__). Misses fall back to the compute layer.
 * Pass `{ obfuscate: true }` to mask secrets for UI display.
 */
export async function getCredentials(
  ctx: AiProviderCtx,
  provider: string,
  model: string | null,
  modelType: ModelType | null,
  options: { obfuscate?: boolean } = {}
): Promise<CredentialsResponse> {
  const { obfuscate = false } = options
  const credentialsMap = await getOrgCache().get(ctx.organizationId, 'aiCredentials')

  const lookupKey =
    model && modelType ? `${provider}:${model}:${modelType}` : `${provider}:__provider__`

  const result = credentialsMap[lookupKey]
  if (result) {
    if (obfuscate && result.credentials && Object.keys(result.credentials).length > 0) {
      return obfuscateResult(provider, result)
    }
    return result
  }

  // Cache miss for this specific key — the model might not have been in the config when the
  // cache was computed. Fall through to direct compute.
  logger.warn('Credentials cache miss for key, falling back to direct lookup', {
    organizationId: ctx.organizationId,
    lookupKey,
  })

  const directResult = await resolveCredentials(ctx, provider, model, modelType)
  if (obfuscate && directResult.credentials && Object.keys(directResult.credentials).length > 0) {
    return obfuscateResult(provider, directResult)
  }
  return directResult
}

/**
 * Always returns the platform-managed (SYSTEM) credentials for the provider, ignoring the
 * org's provider-type preference. Throws if SYSTEM credentials aren't configured — there is no
 * BYO fallback by design.
 */
export async function getSystemCredentials(
  ctx: AiProviderCtx,
  provider: string
): Promise<CredentialsResponse> {
  const config = await getProviderConfig(ctx, provider)
  const credentials = config.systemConfiguration.credentials
  if (!credentials || Object.keys(credentials).length === 0) {
    throw new ProviderConfigurationError(
      `No platform (SYSTEM) credentials configured for provider '${provider}'`,
      provider,
      'SYSTEM_CREDENTIALS_MISSING'
    )
  }
  return { credentials, providerType: 'SYSTEM', credentialSource: 'SYSTEM' }
}

/**
 * Mask credentials for the edit dialog using the unified secret-mask lifecycle: a set secret
 * field is emitted as HIDDEN_VALUE (never its value); plain fields pass through. The save path
 * drops masked echoes, so an unchanged secret survives a round-trip.
 */
async function obfuscateResult(
  provider: string,
  result: CredentialsResponse
): Promise<CredentialsResponse> {
  const providerCaps = await ProviderRegistry.getProviderCapabilities(provider)
  if (providerCaps?.connectionVariables) {
    // The cached result is an already-merged flat bag (plain + secret), so it serves as both the
    // plain and secret source for the shared edit projection.
    return {
      ...result,
      credentials: projectCredentialForEdit(providerCaps.connectionVariables, {
        plain: result.credentials,
        secrets: result.credentials,
      }),
    }
  }
  return result
}

/** Determine the primary model type for a given model from ProviderRegistry capabilities. */
export function getModelTypeForModel(model: string): ModelType {
  const capabilities = ProviderRegistry.getModelCapabilities(model)
  if (
    capabilities?.features.includes('text-embedding') ||
    capabilities?.features.includes('embedding')
  ) {
    return ModelType.TEXT_EMBEDDING
  } else if (capabilities?.supports.vision) {
    return ModelType.VISION
  } else if (capabilities?.features.includes('tts')) {
    return ModelType.TTS
  } else {
    return ModelType.LLM
  }
}

/** Check if a model is compatible with a specific model type. */
export function isModelCompatible(model: string, modelType: ModelType): boolean {
  const capabilities = ProviderRegistry.getModelCapabilities(model)
  if (!capabilities) return false

  switch (modelType) {
    case ModelType.LLM:
      return capabilities.features.includes('chat')
    case ModelType.TEXT_EMBEDDING:
      return (
        capabilities.features.includes('text-embedding') ||
        capabilities.features.includes('embedding')
      )
    case ModelType.VISION:
      return capabilities.supports.vision
    case ModelType.TTS:
      return capabilities.features.includes('tts')
    case ModelType.SPEECH2TEXT:
      return capabilities.features.includes('speech2text')
    case ModelType.MODERATION:
      return capabilities.features.includes('moderation')
    case ModelType.RERANK:
      return capabilities.features.includes('rerank')
    default:
      return false
  }
}

/** Get unified model data with complete ModelCapabilities and status information. */
export async function getUnifiedModelData(
  ctx: AiProviderCtx,
  options: {
    includeDefaults?: boolean
    modelTypes?: ModelType[]
    includeUnconfigured?: boolean
    includeRetired?: boolean
  } = {}
): Promise<{
  providers: ProviderConfiguration[]
  defaultModels: Record<string, { provider: string; model: string }>
}> {
  const { modelTypes = [], includeUnconfigured = false, includeRetired = false } = options

  try {
    const configurations = await getProviderConfigs(ctx)

    let providers = getSortedProviders(Object.values(configurations.configurations))

    if (!includeUnconfigured || modelTypes.length > 0) {
      providers = providers
        .map((provider) => {
          const filteredModels = provider.models.filter((model) => {
            if (!includeUnconfigured && !provider.statusInfo.configured) return false
            if (!includeRetired && model.status === 'retired') return false
            if (
              !includeUnconfigured &&
              model.status !== 'active' &&
              model.status !== 'deprecated'
            ) {
              return false
            }
            if (modelTypes.length > 0) {
              const modelSupportsType = modelTypes.some((type) =>
                isModelCompatible(model.modelId, type)
              )
              if (!modelSupportsType) return false
            }
            return true
          })

          return { ...provider, models: filteredModels }
        })
        .filter((provider) => includeUnconfigured || provider.models.length > 0)
    }

    const cachedDefaults = await getOrgCache().get(ctx.organizationId, 'aiDefaultModels')
    const defaultModels: Record<string, { provider: string; model: string }> = {}
    for (const [modelType, entry] of Object.entries(cachedDefaults)) {
      defaultModels[modelType] = { provider: entry.provider, model: entry.model }
    }

    return { providers, defaultModels }
  } catch (error) {
    logger.error('Failed to get unified model data', {
      organizationId: ctx.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new ProviderConfigurationError(
      'Failed to retrieve unified model data',
      'all',
      'UNIFIED_MODEL_DATA_FAILED'
    )
  }
}
