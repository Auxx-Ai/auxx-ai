// packages/credentials/src/manager/credential-type-registry.ts

import type { ICredentialType } from '@auxx/workflow-nodes/types'
import type { ICredentialTypeRegistry, ProviderInfo, ProviderCapabilities } from '../types'
import { createScopedLogger } from '@auxx/logger'

// Import all credential types for auto-registration
import {
  AwsS3Credentials,
  GoogleDriveStorageOAuth2,
  DropboxOAuth2,
  OneDriveOAuth2,
  BoxOAuth2,
  GoogleOAuth2Api,
  OutlookOAuth2Api,
  FacebookOAuth2Api,
  InstagramOAuth2Api,
  ShopifyOAuth2Api,
  SmtpCredentials,
  Imap,
  Postgres,
  PostgresWithTesting,
  CrateDb,
  AirtableApi,
  AirtableOAuth2Api,
  HttpBasicAuth,
  HttpHeaderAuth,
  OAuth2Api,
  // AI provider credentials
  OpenAIApiCredentials,
  AnthropicApiCredentials,
  GoogleAIApiCredentials,
  GroqApiCredentials,
  DeepSeekApiCredentials,
} from '@auxx/workflow-nodes/credentials'

const logger = createScopedLogger('credential-type-registry')

/**
 * Registry for all credential types in the system
 * Provides provider discovery, metadata, and capability detection
 */
export class CredentialTypeRegistry implements ICredentialTypeRegistry {
  private providers = new Map<string, ICredentialType>()
  private providerInfoCache = new Map<string, ProviderInfo>()

  constructor() {
    this.registerDefaultProviders()
  }

  /**
   * Auto-register all available credential types
   */
  private registerDefaultProviders(): void {
    const credentialTypes: ICredentialType[] = [
      // Storage providers
      new AwsS3Credentials(),
      new GoogleDriveStorageOAuth2(),
      new DropboxOAuth2(),
      new OneDriveOAuth2(),
      new BoxOAuth2(),

      // Auth providers
      new GoogleOAuth2Api(),
      new OutlookOAuth2Api(),
      new FacebookOAuth2Api(),
      new InstagramOAuth2Api(),
      new ShopifyOAuth2Api(),
      new HttpBasicAuth(),
      new HttpHeaderAuth(),
      new OAuth2Api(),

      // Email providers
      new SmtpCredentials(),
      new Imap(),

      // Database providers
      new Postgres(),
      new PostgresWithTesting(),
      new CrateDb(),

      // Data providers
      new AirtableApi(),
      new AirtableOAuth2Api(),

      // AI providers
      new OpenAIApiCredentials(),
      new AnthropicApiCredentials(),
      new GoogleAIApiCredentials(),
      new GroqApiCredentials(),
      new DeepSeekApiCredentials(),
    ]

    for (const credentialType of credentialTypes) {
      try {
        this.registerProvider(credentialType)
      } catch (error) {
        logger.error('Failed to register credential type', {
          credentialType: credentialType.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /**
   * Register a credential provider
   */
  registerProvider(provider: ICredentialType): void {
    if (!provider.name) {
      throw new Error('Credential provider must have a name')
    }

    if (this.providers.has(provider.name)) {
      logger.warn('Overwriting existing credential provider', {
        providerId: provider.name,
      })
    }

    this.providers.set(provider.name, provider)

    // Clear cached provider info to force regeneration
    this.providerInfoCache.delete(provider.name)
  }

  /**
   * Get a credential provider by ID
   */
  getProvider(providerId: string): ICredentialType | null {
    return this.providers.get(providerId) || null
  }

  /**
   * List all registered providers
   */
  listProviders(): ICredentialType[] {
    return Array.from(this.providers.values())
  }

  /**
   * Get provider information with capabilities
   */
  getProviderInfo(providerId: string): ProviderInfo | null {
    // Check cache first
    if (this.providerInfoCache.has(providerId)) {
      return this.providerInfoCache.get(providerId)!
    }

    const provider = this.getProvider(providerId)
    if (!provider) return null

    const providerInfo: ProviderInfo = {
      providerId: provider.name,
      displayName: provider.displayName,
      category: this.getProviderCategory(provider),
      capabilities: this.analyzeProviderCapabilities(provider),
      systemCredentialMapping: this.getSystemCredentialMapping(provider),
      oauth2Config: this.getOAuth2Config(provider),
      hasConnectionTest: Boolean(provider.test),
    }

    // Cache the result
    this.providerInfoCache.set(providerId, providerInfo)
    return providerInfo
  }

  /**
   * Get providers by category
   */
  getProvidersByCategory(category: string): ICredentialType[] {
    return this.listProviders().filter(
      (provider) => this.getProviderCategory(provider) === category
    )
  }

  /**
   * Get providers that support system credentials
   */
  getProvidersWithSystemCredentials(): ICredentialType[] {
    return this.listProviders().filter((provider) => this.hasSystemCredentialSupport(provider.name))
  }

  /**
   * Check if provider supports system credentials
   */
  hasSystemCredentialSupport(providerId: string): boolean {
    const provider = this.getProvider(providerId)
    if (!provider) return false

    // Check for systemCredentialMapping
    const hasMapping = Boolean(this.getSystemCredentialMapping(provider))

    // Check for OAuth2 system client credentials
    const oauth2Config = this.getOAuth2Config(provider)
    const hasOAuth2System = Boolean(
      oauth2Config?.systemClientIdEnv && oauth2Config?.systemClientSecretEnv
    )

    return hasMapping || hasOAuth2System
  }

  /**
   * Get provider category from UI metadata
   */
  private getProviderCategory(provider: ICredentialType): string {
    const uiMetadata = (provider as any).uiMetadata
    return uiMetadata?.category || 'other'
  }

  /**
   * Analyze provider capabilities
   */
  private analyzeProviderCapabilities(provider: ICredentialType): ProviderCapabilities {
    const hasSystemCredentials = this.hasSystemCredentialSupport(provider.name)
    const hasOAuth2 = Boolean(this.getOAuth2Config(provider))

    return {
      orgCredentials: true, // All providers support organization credentials
      systemCredentials: hasSystemCredentials,
      connectionTesting: Boolean(provider.test),
      oauth2Support: hasOAuth2,
    }
  }

  /**
   * Get system credential mapping if available
   */
  private getSystemCredentialMapping(
    provider: ICredentialType
  ): Record<string, string> | undefined {
    return (provider as any).systemCredentialMapping
  }

  /**
   * Get OAuth2 config if available
   */
  private getOAuth2Config(provider: ICredentialType): any {
    return (provider as any).oauth2Config
  }

  /**
   * Get providers grouped by category
   */
  getProvidersByCategories(): Record<string, ICredentialType[]> {
    const categories: Record<string, ICredentialType[]> = {}

    for (const provider of this.listProviders()) {
      const category = this.getProviderCategory(provider)
      if (!categories[category]) {
        categories[category] = []
      }
      categories[category].push(provider)
    }

    return categories
  }

  /**
   * Search providers by name or display name
   */
  searchProviders(query: string): ICredentialType[] {
    const lowercaseQuery = query.toLowerCase()

    return this.listProviders().filter(
      (provider) =>
        provider.name.toLowerCase().includes(lowercaseQuery) ||
        provider.displayName.toLowerCase().includes(lowercaseQuery)
    )
  }

  /**
   * Get provider statistics
   */
  getRegistryStats(): {
    totalProviders: number
    categoryCounts: Record<string, number>
    systemCredentialSupport: number
    oauth2Support: number
    connectionTestSupport: number
  } {
    const providers = this.listProviders()
    const categories = this.getProvidersByCategories()

    return {
      totalProviders: providers.length,
      categoryCounts: Object.fromEntries(
        Object.entries(categories).map(([category, providerList]) => [
          category,
          providerList.length,
        ])
      ),
      systemCredentialSupport: this.getProvidersWithSystemCredentials().length,
      oauth2Support: providers.filter((p) => this.getOAuth2Config(p)).length,
      connectionTestSupport: providers.filter((p) => Boolean(p.test)).length,
    }
  }

  /**
   * Validate provider registration
   */
  validateProvider(provider: ICredentialType): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!provider.name) {
      errors.push('Provider must have a name')
    }

    if (!provider.displayName) {
      errors.push('Provider must have a displayName')
    }

    if (!Array.isArray(provider.properties)) {
      errors.push('Provider must have a properties array')
    }

    // Validate OAuth2 config if present
    const oauth2Config = this.getOAuth2Config(provider)
    if (oauth2Config) {
      if (!oauth2Config.authUrl) {
        errors.push('OAuth2 provider must have authUrl')
      }
      if (!oauth2Config.tokenUrl) {
        errors.push('OAuth2 provider must have tokenUrl')
      }
    }

    // Validate system credential mapping if present
    const systemMapping = this.getSystemCredentialMapping(provider)
    if (systemMapping) {
      if (typeof systemMapping !== 'object') {
        errors.push('systemCredentialMapping must be an object')
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * Clear all cached provider info (useful for testing or dynamic updates)
   */
  clearCache(): void {
    this.providerInfoCache.clear()
  }
}
