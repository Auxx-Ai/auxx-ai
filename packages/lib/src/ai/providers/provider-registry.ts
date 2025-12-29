// packages/lib/src/ai/providers/provider-registry.ts

import { createScopedLogger } from '../../logger'
import { PROVIDER_THEMES } from '../../constants/provider-icons'
import { ModelType, type ModelCapabilities, type ProviderCapabilities } from './types'
import { ProviderClient } from './base/provider-client'
import { ProviderError } from './base/types'
import { OPENAI_MODELS, OPENAI_CAPABILITIES } from './openai/openai-defaults'
import { ANTHROPIC_MODELS, ANTHROPIC_CAPABILITIES } from './anthropic/anthropic-defaults'
import { GOOGLE_MODELS, GOOGLE_CAPABILITIES } from './google/google-defaults'
import { GROQ_MODELS, GROQ_CAPABILITIES } from './groq/groq-defaults'
import { DEEPSEEK_MODELS, DEEPSEEK_CAPABILITIES } from './deepseek/deepseek-defaults'

const logger = createScopedLogger('ProviderRegistry')

// server-only loader map (string literals, so bundler is happy)
const serverLoaders: Record<string, () => Promise<any>> = {
  openai: () => import('./openai'),
  anthropic: () => import('./anthropic'),
  google: () => import('./google'),
  groq: () => import('./groq'),
  deepseek: () => import('./deepseek'),
}

/**
 * Preferred order for provider display in UI
 * Defines the sequence: openai, anthropic, google, groq, deepseek
 */
export const providerPositions: string[] = ['openai', 'anthropic', 'google', 'groq', 'deepseek']

export interface ProviderRegistration {
  // Static metadata (from ModelRegistry)
  capabilities: ProviderCapabilities
  models: Record<string, ModelCapabilities>

  // Dynamic factory info (from ProviderFactory)
  clientClass?: typeof ProviderClient
  isRegistered: boolean
  lastValidated?: Date
}

interface ProviderDefinition {
  id: string
  modulePath: string
  clientClassName: string
}

/**
 * Unified registry for provider management
 * Consolidates static configuration data with dynamic instance management
 * Single source of truth for all provider and model information
 */
export class ProviderRegistry {
  /** Static models imported from provider-specific files */
  private static models: Record<string, ModelCapabilities> = {
    ...OPENAI_MODELS,
    ...ANTHROPIC_MODELS,
    ...GOOGLE_MODELS,
    ...GROQ_MODELS,
    ...DEEPSEEK_MODELS,
  }

  /** Static provider capabilities imported from provider-specific files */
  private static staticProviders: Record<string, ProviderCapabilities> = {
    openai: OPENAI_CAPABILITIES,
    anthropic: ANTHROPIC_CAPABILITIES,
    google: GOOGLE_CAPABILITIES,
    groq: GROQ_CAPABILITIES,
    deepseek: DEEPSEEK_CAPABILITIES,
  }

  /** Provider definitions for dynamic loading */
  private static providerDefinitions: ProviderDefinition[] = [
    {
      id: 'openai',
      modulePath: './openai',
      clientClassName: 'OpenAIClient',
    },
    {
      id: 'anthropic',
      modulePath: './anthropic',
      clientClassName: 'AnthropicClient',
    },
    {
      id: 'google',
      modulePath: './google',
      clientClassName: 'GoogleClient',
    },
    {
      id: 'groq',
      modulePath: './groq',
      clientClassName: 'GroqClient',
    },
    {
      id: 'deepseek',
      modulePath: './deepseek',
      clientClassName: 'DeepSeekClient',
    },
  ]

  /** Unified provider registrations combining static + dynamic data */
  private static providers: Record<string, ProviderRegistration> = {}
  private static initialized = false

  /**
   * Initialize the registry by auto-registering all available providers
   */
  private static async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      // Register all providers with static data
      await Promise.all(
        this.providerDefinitions.map((definition) => this.registerProvider(definition))
      )

      logger.info('ProviderRegistry initialized', {
        registeredProviders: Object.keys(this.providers),
      })

      this.initialized = true
    } catch (error) {
      logger.error('Failed to initialize ProviderRegistry', { error })
      throw new ProviderError('Registry initialization failed', 'registry', 'INIT_FAILED')
    }
  }

  /**
   * Register a provider with both static and dynamic data
   */
  private static async registerProvider(definition: ProviderDefinition): Promise<void> {
    const registration: ProviderRegistration = {
      capabilities: this.staticProviders[definition.id],
      models: this.getModelsForProvider(definition.id),
      clientClass: await this.loadClientClass(definition),
      isRegistered: true,
      lastValidated: new Date(),
    }
    this.providers[definition.id] = registration
  }

  /**
   * Load client class for a provider definition (server-side only)
   */
  private static async loadClientClass(
    definition: ProviderDefinition
  ): Promise<typeof ProviderClient | undefined> {
    if (!this.isServerEnvironment()) {
      logger.debug('Skipping provider load outside Node server', { providerId: definition.id })
      return undefined
    }

    const loader = serverLoaders[definition.id]
    if (!loader) {
      logger.warn('No loader found for provider', { providerId: definition.id })
      return undefined
    }

    try {
      const providerModule = await loader()

      const ClientClass = providerModule[definition.clientClassName] ?? providerModule.default

      if (typeof ClientClass !== 'function') {
        logger.warn('Loaded client is not a constructor', {
          providerId: definition.id,
          exports: Object.keys(providerModule),
          typeofDefault: typeof providerModule.default,
        })
        return undefined
      }

      logger.debug('Successfully loaded client class', {
        providerId: definition.id,
        className: definition.clientClassName,
      })
      return ClientClass
    } catch (error) {
      logger.warn(`Failed to load ${definition.id} provider client`, { error })
    }
    return undefined
  }

  /**
   * Get models for a specific provider from static imports
   */
  private static getModelsForProvider(providerId: string): Record<string, ModelCapabilities> {
    return Object.entries(this.models)
      .filter(([_, model]) => model.provider === providerId)
      .reduce((acc, [key, model]) => ({ ...acc, [key]: model }), {})
  }

  /**
   * Extract capabilities from a provider client instance (fallback, server-side only)
   */
  private static extractCapabilitiesFromClient(providerId: string): ProviderCapabilities | null {
    const registration = this.providers[providerId]
    if (!registration?.clientClass) {
      return null
    }

    // Skip on client side
    if (typeof window !== 'undefined' || !this.isServerEnvironment()) {
      return null
    }

    try {
      // Create a temporary instance to get capabilities
      const tempInstance = new registration.clientClass('temp', 'temp', undefined)
      return tempInstance.getCapabilities()
    } catch (error) {
      logger.error('Failed to extract capabilities from client', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  // ===== MODEL REGISTRY METHODS =====

  static getModelCapabilities(model: string): ModelCapabilities | null {
    return this.models[model] || null
  }

  static getAllModelsForProvider(provider: string): string[] {
    return Object.keys(this.models).filter((model) => this.models[model].provider === provider)
  }

  static getAllModels(): Record<string, ModelCapabilities> {
    return { ...this.models }
  }

  static getModelsByFeature(feature: string): string[] {
    return Object.entries(this.models)
      .filter(([_, capabilities]) => capabilities.features.includes(feature))
      .map(([model]) => model)
  }

  static getModelsBySupport(
    supportType: keyof ModelCapabilities['supports'],
    value = true
  ): string[] {
    return Object.entries(this.models)
      .filter(([_, capabilities]) => capabilities.supports[supportType] === value)
      .map(([model]) => model)
  }

  static isValidModel(model: string): boolean {
    return model in this.models
  }

  static getModelOptionsForProvider(
    provider: string
  ): Array<{ label: string; value: string; icon?: string; color?: string }> {
    return this.getAllModelsForProvider(provider).map((model) => {
      const capabilities = this.models[model]
      return {
        label: capabilities.displayName,
        value: model,
        icon: capabilities.icon,
        color: capabilities.color,
      }
    })
  }

  // ===== PROVIDER REGISTRY METHODS =====

  static async getProviderCapabilities(provider: string): Promise<ProviderCapabilities | null> {
    await this.initialize()

    const registration = this.providers[provider]
    if (!registration) return null

    // Return static capabilities if available
    if (registration.capabilities) {
      return registration.capabilities
    }

    // Fallback to dynamic extraction (like old ProviderFactory)
    return this.extractCapabilitiesFromClient(provider)
  }

  static getAllProviders(): Record<string, ProviderCapabilities> {
    return { ...this.staticProviders }
  }

  static isValidProvider(provider: string): boolean {
    return provider in this.staticProviders
  }

  // ===== PROVIDER FACTORY METHODS =====

  static async createClient(
    providerId: string,
    organizationId: string,
    userId: string,
    cache?: any
  ): Promise<ProviderClient> {
    await this.initialize()

    const registration = this.providers[providerId]

    if (!registration) {
      logger.error('Provider not registered', {
        providerId,
        availableProviders: await this.getAvailableProviders(),
      })
      throw new ProviderError(
        `Provider '${providerId}' is not registered. Available providers: ${(await this.getAvailableProviders()).join(', ')}`,
        providerId,
        'PROVIDER_NOT_REGISTERED'
      )
    }

    if (!registration.clientClass) {
      throw new ProviderError(
        `Provider client for '${providerId}' is not available on client side. This method can only be used server-side.`,
        providerId,
        'CLIENT_SIDE_NOT_SUPPORTED'
      )
    }

    try {
      const instance = new registration.clientClass(organizationId, userId, cache)

      logger.debug('Provider client created', {
        providerId,
        organizationId,
        userId: userId ? userId.substring(0, 8) + '...' : 'system', // Partial user ID for privacy
      })

      return instance
    } catch (error) {
      logger.error('Failed to create provider client', {
        providerId,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })

      throw new ProviderError(
        `Failed to create provider client for '${providerId}': ${error}`,
        providerId,
        'CLIENT_CREATION_FAILED'
      )
    }
  }

  // Alias for createClient to maintain compatibility
  static create = this.createClient

  static async getAvailableProviders(): Promise<string[]> {
    await this.initialize()
    return Object.keys(this.providers).sort()
  }

  static isProviderRegistered(providerId: string): boolean {
    // For synchronous checks, return static provider existence if not initialized
    if (!this.initialized) {
      return providerId in this.staticProviders
    }

    // On client side, check static providers, on server side check full registration
    if (typeof window !== 'undefined' || !this.isServerEnvironment()) {
      return providerId in this.staticProviders
    }
    return this.providers[providerId]?.isRegistered && !!this.providers[providerId]?.clientClass
  }

  static async getAllProviderCapabilities(): Promise<Record<string, ProviderCapabilities>> {
    await this.initialize()

    const capabilities: Record<string, ProviderCapabilities> = {}
    const availableProviders = await this.getAvailableProviders()

    for (const providerId of availableProviders) {
      const caps = await this.getProviderCapabilities(providerId)
      if (caps) {
        capabilities[providerId] = caps
      }
    }

    return capabilities
  }

  static async validateRegisteredProviders(): Promise<{ valid: string[]; invalid: string[] }> {
    await this.initialize()

    const valid: string[] = []
    const invalid: string[] = []
    const availableProviders = await this.getAvailableProviders()

    for (const providerId of availableProviders) {
      try {
        const capabilities = await this.getProviderCapabilities(providerId)
        if (capabilities && this.isValidProvider(providerId)) {
          valid.push(providerId)
        } else {
          invalid.push(providerId)
        }
      } catch (error) {
        invalid.push(providerId)
      }
    }

    logger.info('Provider validation complete', {
      validProviders: valid,
      invalidProviders: invalid,
      totalProviders: valid.length + invalid.length,
    })

    return { valid, invalid }
  }

  static reset(): void {
    Object.keys(this.providers).forEach((key) => delete this.providers[key])
    this.initialized = false
    logger.debug('ProviderRegistry reset')
  }

  static async getStats() {
    return {
      initialized: this.initialized,
      registeredProviders: (await this.getAvailableProviders()).length,
      providers: this.getAvailableProviders(),
      totalModels: Object.keys(this.models).length,
      staticProviders: Object.keys(this.staticProviders).length,
    }
  }

  /**
   * Check if we're running in a server environment
   * More robust than just checking for window or process
   */
  private static isServerEnvironment(): boolean {
    const inBrowser = typeof window !== 'undefined'
    const inEdge = typeof process !== 'undefined' && process.env.NEXT_RUNTIME === 'edge'
    const inNode = typeof process !== 'undefined' && !!process.versions?.node
    return !inBrowser && !inEdge && inNode
  }

  // ===== ADDITIONAL UTILITY METHODS =====

  static async register(providerId: string, clientClass: typeof ProviderClient): Promise<void> {
    await this.initialize()

    if (this.providers[providerId]) {
      logger.warn('Provider already registered, overriding', { providerId })
    }

    const registration: ProviderRegistration = {
      capabilities: this.staticProviders[providerId] || ({} as ProviderCapabilities),
      models: this.getModelsForProvider(providerId),
      clientClass,
      isRegistered: true,
      lastValidated: new Date(),
    }

    this.providers[providerId] = registration

    logger.debug('Provider registered', {
      providerId,
      totalProviders: Object.keys(this.providers).length,
    })
  }

  static async unregister(providerId: string): Promise<boolean> {
    await this.initialize()

    const existed = providerId in this.providers
    if (existed) {
      delete this.providers[providerId]
      logger.debug('Provider unregistered', { providerId })
    }
    return existed
  }
}

// Export legacy aliases for backward compatibility
export const ModelRegistry = ProviderRegistry
export const ProviderFactory = ProviderRegistry
