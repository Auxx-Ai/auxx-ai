// packages/lib/src/ai/providers/provider-cache-service.ts

import { BaseCacheService, type CacheOptions } from '../../cache/base-cache-service'
import type {
  CredentialsResponse,
  DefaultModelEntity,
  ModelType,
  ProviderConfiguration,
  ProviderConfigurations,
} from './types'

export class ProviderCacheService extends BaseCacheService {
  constructor() {
    super('ai_provider', 900) // 15 minute default TTL
  }

  // Specialized cache methods for AI providers
  async getProviderConfig(
    organizationId: string,
    provider: string
  ): Promise<ProviderConfiguration | null> {
    const key = this.buildProviderConfigKey(organizationId, provider)
    return await this.get<ProviderConfiguration>(key)
  }

  async setProviderConfig(
    organizationId: string,
    provider: string,
    config: ProviderConfiguration,
    options?: CacheOptions
  ): Promise<void> {
    const key = this.buildProviderConfigKey(organizationId, provider)
    const tags = [`org:${organizationId}`, `provider:${provider}`, 'provider_config']

    await this.set(key, config, {
      ...options,
      tags: [...(options?.tags || []), ...tags],
    })
  }

  async getCurrentCredentials(
    organizationId: string,
    provider: string,
    model: string,
    modelType: ModelType,
    obfuscate: boolean = true
  ): Promise<CredentialsResponse | null> {
    const key = this.buildCurrentCredentialsKey(
      organizationId,
      provider,
      model,
      modelType,
      obfuscate
    )
    return await this.get<CredentialsResponse>(key)
  }
  async setCurrentCredentials(
    organizationId: string,
    provider: string,
    model: string,
    modelType: ModelType,
    credentials: CredentialsResponse,
    options?: CacheOptions,
    obfuscate: boolean = true
  ): Promise<void> {
    const key = this.buildCurrentCredentialsKey(
      organizationId,
      provider,
      model,
      modelType,
      obfuscate
    )
    const tags = [
      `org:${organizationId}`,
      `provider:${provider}`,
      `model:${model}`,
      `model_type:${modelType}`,
      `obfuscate:${obfuscate}`,
    ]

    await this.set(key, credentials, {
      ...options,
      tags: [...(options?.tags || []), ...tags],
    })
  }

  private buildCurrentCredentialsKey(
    organizationId: string,
    provider: string,
    model: string,
    modelType: ModelType,
    obfuscate: boolean = true
  ): string {
    return this.buildKey(
      'current_credentials',
      organizationId,
      provider,
      model,
      modelType,
      obfuscate.toString()
    )
  }

  async getAllProviderConfigs(organizationId: string): Promise<ProviderConfigurations | null> {
    const key = this.buildAllConfigsKey(organizationId)
    return await this.get<ProviderConfigurations>(key)
  }

  async setAllProviderConfigs(
    organizationId: string,
    configurations: ProviderConfigurations,
    options?: CacheOptions
  ): Promise<void> {
    const key = this.buildAllConfigsKey(organizationId)
    const tags = [`org:${organizationId}`, 'all_provider_configs']

    await this.set(key, configurations, {
      ...options,
      tags: [...(options?.tags || []), ...tags],
    })
  }

  async getDefaultModel(
    organizationId: string,
    modelType: string
  ): Promise<DefaultModelEntity | null> {
    const key = this.buildDefaultModelKey(organizationId, modelType)
    return await this.get<DefaultModelEntity>(key)
  }

  async setDefaultModel(
    organizationId: string,
    modelType: string,
    defaultModel: DefaultModelEntity,
    options?: CacheOptions
  ): Promise<void> {
    const key = this.buildDefaultModelKey(organizationId, modelType)
    const tags = [`org:${organizationId}`, `model_type:${modelType}`, 'default_model']

    await this.set(key, defaultModel, {
      ...options,
      tags: [...(options?.tags || []), ...tags],
    })
  }

  // Cache key builders
  private buildProviderConfigKey(organizationId: string, provider: string): string {
    return this.buildKey('config', organizationId, provider)
  }

  private buildAllConfigsKey(organizationId: string): string {
    return this.buildKey('all_configs', organizationId)
  }

  private buildDefaultModelKey(organizationId: string, modelType: string): string {
    return this.buildKey('default', organizationId, modelType)
  }

  // Specialized invalidation methods
  async invalidateProvider(organizationId: string, provider: string): Promise<void> {
    // Invalidate specific provider config key
    const providerConfigKey = this.buildProviderConfigKey(organizationId, provider)
    await this.delete(providerConfigKey)

    // Invalidate provider status cache key (from ProviderManager)
    const providerStatusKey = this.buildKey('provider_status', organizationId, provider)
    await this.delete(providerStatusKey)

    // Invalidate all configs for organization (this contains all providers)
    const allConfigsKey = this.buildAllConfigsKey(organizationId)
    await this.delete(allConfigsKey)

    // Invalidate all credential cache entries for this provider
    // This handles both provider-only credentials and model-specific credentials
    // for both obfuscated and non-obfuscated versions
    await this.invalidateByPattern(new RegExp(`current_credentials:${organizationId}:${provider}:`))

    // Also invalidate by tags as backup
    await this.invalidateByTag(`provider:${provider}`)
    await this.invalidateByTag(`org:${organizationId}`)
  }

  async invalidateOrganization(organizationId: string): Promise<void> {
    // Invalidate all configs for organization
    const allConfigsKey = this.buildAllConfigsKey(organizationId)
    await this.delete(allConfigsKey)

    // Invalidate all default models for organization
    const modelTypes = [
      'LLM',
      'TEXT_EMBEDDING',
      'VISION',
      'TTS',
      'SPEECH2TEXT',
      'MODERATION',
      'RERANK',
    ]
    for (const modelType of modelTypes) {
      const defaultModelKey = this.buildDefaultModelKey(organizationId, modelType)
      await this.delete(defaultModelKey)
    }

    // Also invalidate by tag as backup
    await this.invalidateByTag(`org:${organizationId}`)
  }

  // Create a singleton instance
  private static instance: ProviderCacheService

  static getInstance(): ProviderCacheService {
    if (!ProviderCacheService.instance) {
      ProviderCacheService.instance = new ProviderCacheService()
    }
    return ProviderCacheService.instance
  }
}
