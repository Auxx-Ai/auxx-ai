// packages/lib/src/ai/providers/provider-manager.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '../../logger'
import { ProviderCacheService } from './provider-cache-service'
import { ProviderConfigurationService } from './provider-configuration-service'
import { ProviderRegistry } from './provider-registry'
import { SystemModelService } from './system-model-service'
import {
  type CacheOptions,
  // type ProviderCredentials,
  // type ProviderData,
  type CredentialsResponse,
  ModelType,
  type ProviderConfiguration,
  // ProviderType,
  ProviderConfigurationError,
  type ProviderConfigurations,
} from './types'
import { getSortedProviders, obfuscateCredentials } from './utils'

const logger = createScopedLogger('ProviderManager')

/**
 * Main orchestrator for AI Provider management
 * Handles configuration retrieval, caching, and provider instance creation
 */
export class ProviderManager {
  private configurationService: ProviderConfigurationService
  private cache: ProviderCacheService

  /**
   * Constructor for ProviderManager
   * Initializes configuration service and cache service for provider management
   * @param db - Drizzle database client for data access
   * @param organizationId - Organization identifier for scoped operations
   * @param userId - User identifier for audit and access control
   */
  constructor(
    private db: Database,
    private organizationId: string,
    private userId: string
  ) {
    this.configurationService = new ProviderConfigurationService(db, organizationId, userId)
    this.cache = ProviderCacheService.getInstance()
  }

  // ===== MAIN CONFIGURATION METHODS =====

  /**
   * Get all provider configurations for the organization
   * Retrieves configuration data for all supported providers in parallel
   * Continues processing even if individual provider configurations fail
   * @param options - Caching options including skipCache and ttl settings
   * @returns Promise<ProviderConfigurations> - Object containing all provider configurations
   * @throws ProviderConfigurationError - When overall configuration retrieval fails
   */
  async getConfigurations(options: CacheOptions = {}): Promise<ProviderConfigurations> {
    logger.info('Getting all provider configurations', { organizationId: this.organizationId })

    try {
      const configurations = await this.configurationService.getConfigurations()
      return configurations
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
   * Get configuration for a specific provider with caching support
   * Checks cache first, then retrieves from configuration service if needed
   * Automatically caches results with tags for efficient invalidation
   * @param provider - The provider name to get configuration for
   * @param options - Caching options including skipCache and custom ttl
   * @returns Promise<ProviderConfiguration> - Complete provider configuration
   */
  async getProviderConfiguration(
    provider: string,
    options: CacheOptions = {}
  ): Promise<ProviderConfiguration> {
    if (!options.skipCache) {
      const cached = await this.cache.getProviderConfig(this.organizationId, provider)
      if (cached) return cached
    }

    const config = await this.configurationService.getProviderConfiguration(provider)

    await this.cache.setProviderConfig(this.organizationId, provider, config, {
      ttl: options.ttl || 900,
      tags: [`provider:${provider}`, `org:${this.organizationId}`],
    })

    return config
  }

  async getCurrentCredentials(
    provider: string,
    model: string | null,
    modelType: ModelType | null,
    obfuscate: boolean = true,
    options: CacheOptions = {}
  ): Promise<CredentialsResponse> {
    // Build cache key that includes mode information
    // options.skipCache = true

    if (!options.skipCache) {
      const cached = await this.cache.getCurrentCredentials(
        this.organizationId,
        provider,
        model || '__provider__', // Use special marker for provider-only
        modelType || ModelType.LLM, // Default for cache key consistency
        obfuscate
      )
      if (cached) return cached
    }

    // Use getCurrentCredentials to get providerType and credentialSource for quota tracking
    const result = await this.configurationService.getCurrentCredentials(provider, model, modelType)

    // Optionally obfuscate credentials for display purposes
    if (obfuscate && result.credentials && Object.keys(result.credentials).length > 0) {
      const providerCaps = await ProviderRegistry.getProviderCapabilities(provider)
      if (providerCaps?.credentialSchema) {
        // Convert CredentialFormField[] to CredentialFormSchema[] format for obfuscation
        const schemas = providerCaps.credentialSchema.map((field) => ({
          variable: field.variable,
          type: field.type as any, // Type mapping between form field types
          required: field.required,
          default: field.default as string | number | boolean | undefined,
          label: field.label ? { en_US: field.label } : undefined,
        }))
        result.credentials = obfuscateCredentials(result.credentials, schemas)
      }
    }

    await this.cache.setCurrentCredentials(
      this.organizationId,
      provider,
      model || '__provider__',
      modelType || ModelType.LLM,
      result,
      {
        ttl: options.ttl || 900,
        tags: [`provider:${provider}`, `org:${this.organizationId}`],
      },
      obfuscate
    )

    return result
  }

  // ===== UTILITY METHODS =====

  /**
   * Invalidate cache for a specific provider
   * Removes all cached data related to the provider for this organization
   * Used when provider configuration changes to ensure fresh data
   * @param provider - The provider name to invalidate cache for
   * @returns Promise<void> - Resolves when cache invalidation completes
   */
  invalidateProvider(provider: string): Promise<void> {
    return this.cache.invalidateProvider(this.organizationId, provider)
  }

  /**
   * Invalidate all cached data for the organization
   * Removes all provider and configuration cache entries for this organization
   * Used for complete cache refresh when major configuration changes occur
   * @returns Promise<void> - Resolves when organization cache invalidation completes
   */
  invalidateOrganization(): Promise<void> {
    return this.cache.invalidateOrganization(this.organizationId)
  }

  /**
   * Determine the primary model type for a given model
   * Uses ProviderRegistry capabilities to classify model based on features
   * Prioritizes specialized types (embedding, vision, tts) over general LLM
   * @param model - The model name to classify
   * @returns ModelType - The primary model type for this model
   */
  private _getModelTypeForModel(model: string): ModelType {
    const capabilities = ProviderRegistry.getModelCapabilities(model)

    // Primary determination based on features
    // Check for both 'text-embedding' (model definitions) and 'embedding' (legacy)
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
      return ModelType.LLM // Default
    }
  }

  /**
   * Check if a model is compatible with a specific model type
   * Uses ProviderRegistry capabilities to determine feature compatibility
   * Validates that model supports the required features for the model type
   * @param model - The model name to check compatibility for
   * @param modelType - The model type to check compatibility against
   * @returns boolean - True if model supports the model type, false otherwise
   */
  isModelCompatible(model: string, modelType: ModelType): boolean {
    const capabilities = ProviderRegistry.getModelCapabilities(model)
    if (!capabilities) return false

    switch (modelType) {
      case ModelType.LLM:
        return capabilities.features.includes('chat')
      case ModelType.TEXT_EMBEDDING:
        // Check for both 'text-embedding' (model definitions) and 'embedding' (legacy)
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

  /**
   * Invalidate cached status information for a specific provider
   * Removes status cache entries to force fresh calculation on next access
   * Used when provider configuration changes affect status
   * @param provider - The provider name to invalidate status cache for
   * @returns Promise<void> - Resolves when status cache invalidation completes
   */
  async invalidateProviderStatus(provider: string): Promise<void> {
    await this.cache.invalidateByTag(`provider:${provider}`)
  }

  /**
   * Invalidate all cached status information for the organization
   * Removes all status cache entries to force fresh calculation
   * Used for organization-wide configuration changes
   * @returns Promise<void> - Resolves when all status cache invalidation completes
   */
  async invalidateAllStatus(): Promise<void> {
    await this.cache.invalidateByTag(`org:${this.organizationId}`)
  }

  // ===== UNIFIED MODEL DATA METHODS =====

  /**
   * Get unified model data with complete ModelCapabilities and status information
   * Now simplified to delegate to enhanced ProviderConfigurationService
   * Returns rich data structure with all model metadata and configuration status
   * @param options - Filtering and configuration options
   * @returns Promise<{providers: ProviderData[], defaultModel: any}> - Complete model data
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
      // Get enhanced configurations (now includes complete ModelData AND ProviderData!)
      const configurations = await this.getConfigurations()

      // configurations.configurations is Record<string, ProviderConfiguration>
      // where ProviderConfiguration extends ProviderData
      // So Object.values() returns ProviderConfiguration[] which IS ProviderData[]!

      // Sort providers by configuration status first, then by position
      let providers = getSortedProviders(Object.values(configurations.configurations))

      // Apply filtering if requested
      if (!includeUnconfigured || modelTypes.length > 0) {
        providers = providers
          .map((provider) => {
            const filteredModels = provider.models.filter((model) => {
              // Filter by provider configuration unless including unconfigured
              if (!includeUnconfigured && !provider.statusInfo.configured) {
                return false
              }

              // Filter out retired models unless explicitly included
              if (!includeRetired && model.status === 'retired') {
                return false
              }

              // Filter by model status unless including unconfigured
              // Deprecated models are still usable, so include them
              if (
                !includeUnconfigured &&
                model.status !== 'active' &&
                model.status !== 'deprecated'
              ) {
                return false
              }

              // Filter by model types if specified
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
            // Remove providers with no models after filtering, unless including unconfigured
            return includeUnconfigured || provider.models.length > 0
          })
      }

      // Build default models map from system model defaults
      const systemModelService = new SystemModelService(this.db, this.organizationId)
      const defaults = await systemModelService.getAllDefaults()

      const defaultModels: Record<string, { provider: string; model: string }> = {}
      for (const entry of defaults) {
        defaultModels[entry.modelType] = {
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

  /**
   * Save provider configuration with clean method name
   * Delegates to ProviderConfigurationService with consistent error handling
   * @param provider - Provider name to save configuration for
   * @param credentials - Provider credentials to save
   * @returns Promise<void> - Resolves when provider is saved
   */
  async saveProvider(provider: string, credentials: Record<string, any>): Promise<void> {
    logger.info('Saving provider configuration', { organizationId: this.organizationId, provider })

    await this.configurationService.addCustomProviderCredentials(provider, credentials)
    await this.invalidateProvider(provider)
  }

  /**
   * Delete provider configuration with clean method name
   * Delegates to ProviderConfigurationService with cache invalidation
   * @param provider - Provider name to delete configuration for
   * @returns Promise<void> - Resolves when provider is deleted
   */
  async deleteProvider(provider: string): Promise<void> {
    logger.info('Deleting provider configuration', {
      organizationId: this.organizationId,
      provider,
    })

    await this.configurationService.deleteProvider(provider)
    await this.invalidateProvider(provider)
  }

  /**
   * Test provider credentials with clean method name
   * Delegates to ProviderConfigurationService for credential validation
   * @param provider - Provider name to test
   * @param credentials - Credentials to test
   * @returns Promise<boolean> - True if credentials are valid
   */
  async testProvider(provider: string, credentials: Record<string, any>): Promise<boolean> {
    logger.info('Testing provider credentials', { organizationId: this.organizationId, provider })

    return await this.configurationService.testCredentials(provider, credentials)
  }

  /**
   * Toggle model enabled state with clean method name
   * Updates model configuration and invalidates relevant caches
   * @param provider - Provider name hosting the model
   * @param model - Model name to toggle
   * @param enabled - New enabled state
   * @returns Promise<void> - Resolves when model is toggled
   */
  async toggleModel(provider: string, model: string, enabled: boolean): Promise<void> {
    logger.info('Toggling model enabled state', {
      organizationId: this.organizationId,
      provider,
      model,
      enabled,
    })

    await this.configurationService.toggleModel(provider, model, enabled)
    await this.invalidateProvider(provider)
  }

  /**
   * Update model configuration with clean method name
   * Updates model-specific configuration and invalidates caches
   * @param provider - Provider name hosting the model
   * @param model - Model name to update
   * @param config - New model configuration
   * @returns Promise<void> - Resolves when model config is updated
   */
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
    await this.invalidateProvider(provider)
  }

  /**
   * Save custom model configuration (handles both create and update)
   * @param params - Custom model save parameters with mode
   * @returns Promise<void> - Resolves when custom model is saved
   */
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

    // Validate provider exists
    const providerCaps = await ProviderRegistry.getProviderCapabilities(provider)
    if (!providerCaps) {
      throw new ProviderConfigurationError(
        `Provider '${provider}' not found in registry`,
        provider,
        'PROVIDER_NOT_FOUND'
      )
    }

    // Create or update model configuration with credentials
    await this.configurationService.addCustomModelCredentials(
      provider,
      modelId,
      modelType,
      credentials
    )

    // Invalidate provider cache to include new/updated model
    await this.invalidateProvider(provider)

    logger.info('Custom model saved successfully', {
      organizationId: this.organizationId,
      provider,
      modelId,
      mode,
    })
  }

  /**
   * Delete a custom model configuration
   * @param params - Custom model delete parameters
   * @returns Promise<{ deleted: boolean }> - Deletion result
   */
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

    // Invalidate provider cache to reflect model removal
    await this.invalidateProvider(provider)

    logger.info('Custom model deleted successfully', {
      organizationId: this.organizationId,
      provider,
      modelId,
      deleted: result.deleted,
    })

    return result
  }

  /**
   * Remove custom credentials for a provider
   * Clears credentials and switches to system mode, preserving quota data
   * @param provider - The provider name
   * @returns Promise<RemoveCredentialsResult> - Removal result
   */
  async removeCustomCredentials(provider: string): Promise<{
    removed: boolean
    switchedToSystem: boolean
    hasQuota: boolean
  }> {
    const result = await this.configurationService.removeCustomCredentials(provider)
    await this.invalidateProvider(provider)
    return result
  }
}
