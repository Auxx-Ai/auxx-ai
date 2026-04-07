// packages/lib/src/ai/providers/provider-manager.ts

import type { Database } from '@auxx/database'
import { onCacheEvent } from '../../cache/invalidate'
import { getOrgCache } from '../../cache/singletons'
import { createScopedLogger } from '../../logger'
import { ProviderConfigurationService } from './provider-configuration-service'
import { ProviderRegistry } from './provider-registry'
import {
  type CredentialsResponse,
  ModelType,
  type ProviderConfiguration,
  ProviderConfigurationError,
  type ProviderConfigurations,
} from './types'
import { getSortedProviders, obfuscateCredentials } from './utils'

const logger = createScopedLogger('ProviderManager')

/**
 * Main orchestrator for AI Provider management.
 * Reads configuration and credentials from OrgCache (4-stage: local → Redis hash → Redis data → compute).
 * Mutations invalidate via onCacheEvent() for declarative, graph-driven cache invalidation.
 */
export class ProviderManager {
  private configurationService: ProviderConfigurationService

  constructor(
    private db: Database,
    private organizationId: string,
    private userId: string
  ) {
    this.configurationService = new ProviderConfigurationService(db, organizationId, userId)
  }

  // ===== MAIN CONFIGURATION METHODS =====

  /**
   * Get all provider configurations for the organization.
   * Reads from OrgCache (aiProviderConfigs key).
   */
  async getConfigurations(): Promise<ProviderConfigurations> {
    logger.info('Getting all provider configurations', { organizationId: this.organizationId })

    try {
      const configurations = await getOrgCache().get(this.organizationId, 'aiProviderConfigs')
      return { organizationId: this.organizationId, configurations }
    } catch (error) {
      logger.error('Failed to get provider configurations', {
        organizationId: this.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })

      throw new ProviderConfigurationError(
        'Failed to retrieve provider configurations',
        'all',
        'CONFIGURATIONS_RETRIEVAL_FAILED'
      )
    }
  }

  /**
   * Get configuration for a specific provider.
   * Extracts from the full aiProviderConfigs cache.
   */
  async getProviderConfiguration(provider: string): Promise<ProviderConfiguration> {
    const configurations = await getOrgCache().get(this.organizationId, 'aiProviderConfigs')
    const config = configurations[provider]
    if (!config) {
      throw new ProviderConfigurationError(
        `Provider '${provider}' not found in configurations`,
        provider,
        'PROVIDER_NOT_FOUND'
      )
    }
    return config
  }

  /**
   * Get credentials for a provider or model.
   * Reads from OrgCache (aiCredentials key) and looks up by compound key.
   * Always returns non-obfuscated credentials — obfuscation is applied at the tRPC layer.
   */
  async getCurrentCredentials(
    provider: string,
    model: string | null,
    modelType: ModelType | null,
    obfuscate: boolean = false
  ): Promise<CredentialsResponse> {
    const credentialsMap = await getOrgCache().get(this.organizationId, 'aiCredentials')

    // Build lookup key matching how the provider computes them
    const lookupKey =
      model && modelType ? `${provider}:${model}:${modelType}` : `${provider}:__provider__`

    const result = credentialsMap[lookupKey]

    if (result) {
      // Apply obfuscation at read time if requested (for UI display only)
      if (obfuscate && result.credentials && Object.keys(result.credentials).length > 0) {
        return this._obfuscateResult(provider, result)
      }
      return result
    }

    // Cache miss for this specific key — the model might not have been in the config
    // when the cache was computed. Fall through to direct service call.
    logger.warn('Credentials cache miss for key, falling back to direct lookup', {
      organizationId: this.organizationId,
      lookupKey,
    })

    const directResult = await this.configurationService.getCurrentCredentials(
      provider,
      model,
      modelType
    )

    if (obfuscate && directResult.credentials && Object.keys(directResult.credentials).length > 0) {
      return this._obfuscateResult(provider, directResult)
    }

    return directResult
  }

  /**
   * Apply credential obfuscation using provider's credential schema.
   * Returns a new CredentialsResponse with sensitive values replaced by __HIDDEN__.
   */
  private async _obfuscateResult(
    provider: string,
    result: CredentialsResponse
  ): Promise<CredentialsResponse> {
    const providerCaps = await ProviderRegistry.getProviderCapabilities(provider)
    if (providerCaps?.credentialSchema) {
      const schemas = providerCaps.credentialSchema.map((field) => ({
        variable: field.variable,
        type: field.type as any,
        required: field.required,
        default: field.default as string | number | boolean | undefined,
        label: field.label ? { en_US: field.label } : undefined,
      }))
      return {
        ...result,
        credentials: obfuscateCredentials(result.credentials, schemas),
      }
    }
    return result
  }

  // ===== UTILITY METHODS =====

  /**
   * Determine the primary model type for a given model.
   * Uses ProviderRegistry capabilities to classify model based on features.
   */
  private _getModelTypeForModel(model: string): ModelType {
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

  /**
   * Check if a model is compatible with a specific model type.
   */
  isModelCompatible(model: string, modelType: ModelType): boolean {
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

  // ===== UNIFIED MODEL DATA METHODS =====

  /**
   * Get unified model data with complete ModelCapabilities and status information.
   */
  async getUnifiedModelData(
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
    const {
      includeDefaults = true,
      modelTypes = [],
      includeUnconfigured = false,
      includeRetired = false,
    } = options

    logger.info('Getting unified model data', {
      organizationId: this.organizationId,
      includeDefaults,
      modelTypes,
      includeUnconfigured,
    })

    try {
      const configurations = await this.getConfigurations()

      let providers = getSortedProviders(Object.values(configurations.configurations))

      if (!includeUnconfigured || modelTypes.length > 0) {
        providers = providers
          .map((provider) => {
            const filteredModels = provider.models.filter((model) => {
              if (!includeUnconfigured && !provider.statusInfo.configured) {
                return false
              }

              if (!includeRetired && model.status === 'retired') {
                return false
              }

              if (
                !includeUnconfigured &&
                model.status !== 'active' &&
                model.status !== 'deprecated'
              ) {
                return false
              }

              if (modelTypes.length > 0) {
                const modelSupportsType = modelTypes.some((type) => {
                  return this.isModelCompatible(model.modelId, type)
                })
                if (!modelSupportsType) return false
              }

              return true
            })

            return {
              ...provider,
              models: filteredModels,
            }
          })
          .filter((provider) => {
            return includeUnconfigured || provider.models.length > 0
          })
      }

      // Read default models from OrgCache
      const cachedDefaults = await getOrgCache().get(this.organizationId, 'aiDefaultModels')
      const defaultModels: Record<string, { provider: string; model: string }> = {}
      for (const [modelType, entry] of Object.entries(cachedDefaults)) {
        defaultModels[modelType] = {
          provider: entry.provider,
          model: entry.model,
        }
      }

      return {
        providers,
        defaultModels,
      }
    } catch (error) {
      logger.error('Failed to get unified model data', {
        organizationId: this.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })

      throw new ProviderConfigurationError(
        'Failed to retrieve unified model data',
        'all',
        'UNIFIED_MODEL_DATA_FAILED'
      )
    }
  }

  // ===== CLEAN PROXY METHODS =====

  async saveProvider(provider: string, credentials: Record<string, any>): Promise<void> {
    logger.info('Saving provider configuration', { organizationId: this.organizationId, provider })

    await this.configurationService.addCustomProviderCredentials(provider, credentials)
    await onCacheEvent('ai-provider.configured', { orgId: this.organizationId })
  }

  async deleteProvider(provider: string): Promise<void> {
    logger.info('Deleting provider configuration', {
      organizationId: this.organizationId,
      provider,
    })

    await this.configurationService.deleteProvider(provider)
    await onCacheEvent('ai-provider.deleted', { orgId: this.organizationId })
  }

  async testProvider(provider: string, credentials: Record<string, any>): Promise<boolean> {
    logger.info('Testing provider credentials', { organizationId: this.organizationId, provider })

    return await this.configurationService.testCredentials(provider, credentials)
  }

  async toggleModel(provider: string, model: string, enabled: boolean): Promise<void> {
    logger.info('Toggling model enabled state', {
      organizationId: this.organizationId,
      provider,
      model,
      enabled,
    })

    await this.configurationService.toggleModel(provider, model, enabled)
    await onCacheEvent('ai-provider.configured', { orgId: this.organizationId })
  }

  async updateModelConfig(
    provider: string,
    model: string,
    config: Record<string, any>
  ): Promise<void> {
    logger.info('Updating model configuration', {
      organizationId: this.organizationId,
      provider,
      model,
    })

    await this.configurationService.updateModelConfig(provider, model, config)
    await onCacheEvent('ai-provider.configured', { orgId: this.organizationId })
  }

  async saveCustomModel(params: {
    provider: string
    modelId: string
    modelType: ModelType
    credentials: Record<string, any>
    mode: 'create' | 'edit'
  }): Promise<void> {
    const { provider, modelId, modelType, credentials, mode } = params

    logger.info('Saving custom model', {
      organizationId: this.organizationId,
      provider,
      modelId,
      modelType,
      mode,
    })

    const providerCaps = await ProviderRegistry.getProviderCapabilities(provider)
    if (!providerCaps) {
      throw new ProviderConfigurationError(
        `Provider '${provider}' not found in registry`,
        provider,
        'PROVIDER_NOT_FOUND'
      )
    }

    await this.configurationService.addCustomModelCredentials(
      provider,
      modelId,
      modelType,
      credentials
    )

    await onCacheEvent('ai-model.configured', { orgId: this.organizationId })

    logger.info('Custom model saved successfully', {
      organizationId: this.organizationId,
      provider,
      modelId,
      mode,
    })
  }

  async deleteCustomModel(params: {
    provider: string
    modelId: string
  }): Promise<{ deleted: boolean }> {
    const { provider, modelId } = params

    logger.info('Deleting custom model', {
      organizationId: this.organizationId,
      provider,
      modelId,
    })

    const result = await this.configurationService.deleteCustomModel(provider, modelId)

    await onCacheEvent('ai-model.deleted', { orgId: this.organizationId })

    logger.info('Custom model deleted successfully', {
      organizationId: this.organizationId,
      provider,
      modelId,
      deleted: result.deleted,
    })

    return result
  }

  async removeCustomCredentials(provider: string): Promise<{
    removed: boolean
    switchedToSystem: boolean
    hasQuota: boolean
  }> {
    const result = await this.configurationService.removeCustomCredentials(provider)
    await onCacheEvent('ai-provider.deleted', { orgId: this.organizationId })
    return result
  }
}
