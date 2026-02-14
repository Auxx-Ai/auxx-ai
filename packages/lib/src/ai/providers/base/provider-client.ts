// packages/lib/src/ai/providers/base/provider-client.ts

import type { Database } from '@auxx/database'
import { createScopedLogger, type Logger } from '@auxx/logger'
import type { BaseSpecializedClient } from '../../clients/base/base-specialized-client'
import {
  type CredentialFormField,
  type ModelCapabilities,
  ModelType,
  type ProviderCapabilities,
} from '../types'
import type {
  ConnectionTestResult,
  ProviderCredentials,
  SchemaValidationResult,
  ValidationResult,
} from './types'
import { ValidationUtils } from './validation'

/**
 * Abstract base class for all AI provider clients
 * Each provider must extend this class and implement the abstract methods
 */
export abstract class ProviderClient {
  protected logger: Logger

  constructor(
    protected capabilities: ProviderCapabilities,
    protected organizationId: string,
    protected userId: string,
    protected cache?: any, // CacheService - avoiding circular imports for now
    protected db?: Database
  ) {
    this.logger = createScopedLogger(`ProviderClient:${capabilities.id}`)
  }

  // ===== ABSTRACT METHODS (each provider must implement) =====

  /**
   * Validate provider credentials by testing the actual API connection
   * This should make a real API call to verify the credentials work
   */
  abstract validateCredentials(credentials: Record<string, any>): Promise<ValidationResult>

  /**
   * Test connection to the provider's API
   * This can optionally test a specific model
   */
  abstract testConnection(
    credentials: Record<string, any>,
    model?: string
  ): Promise<ConnectionTestResult>

  /**
   * Extract and normalize credentials from raw input
   * This handles different credential formats and naming conventions
   */
  abstract extractCredentials(rawCredentials: Record<string, any>): ProviderCredentials

  /**
   * Get the provider's SDK client instance
   * Returns the actual SDK client (OpenAI, Anthropic, etc.)
   */
  abstract getApiClient(credentials: ProviderCredentials): any

  /**
   * Get all models supported by this provider
   * Returns the model definitions from the provider's defaults
   */
  abstract getModels(): Record<string, ModelCapabilities>

  /**
   * Get specialized client by model type
   * This is the new method that provides access to specialized clients
   */
  abstract getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient

  // ===== CONCRETE METHODS (common implementation) =====

  /**
   * Validate credentials against the provider's schema only (no API calls)
   */
  validateSchema(credentials: Record<string, any>): SchemaValidationResult {
    const schema = this.capabilities.credentialSchema ?? []

    this.logger.debug('Validating credential schema', {
      provider: this.getProviderId(),
      fieldsCount: schema.length,
    })

    return ValidationUtils.validateCredentialSchema(credentials, schema)
  }

  /**
   * Check if this provider supports a specific model
   */
  supportsModel(model: string): boolean {
    const models = this.getModels()
    return model in models
  }

  /**
   * Get model capabilities for a specific model
   */
  getModelCapabilities(model: string): ModelCapabilities | null {
    const models = this.getModels()
    return models[model] || null
  }

  /**
   * Check if this provider supports a specific model type
   */
  supportsModelType(type: ModelType): boolean {
    return this.capabilities.supportedModelTypes.includes(type)
  }

  /**
   * Check if provider has a specific capability
   */
  hasCapability(capability: string): boolean {
    switch (capability) {
      case 'streaming':
        return (
          this.capabilities.toolFormat === 'openai' || this.capabilities.toolFormat === 'anthropic'
        )
      case 'tools':
        return (
          this.capabilities.toolFormat === 'openai' || this.capabilities.toolFormat === 'anthropic'
        )
      case 'vision':
        return this.capabilities.supportedModelTypes.includes(ModelType.VISION)
      case 'embeddings':
        return this.capabilities.supportedModelTypes.includes(ModelType.TEXT_EMBEDDING)
      default:
        return false
    }
  }

  /**
   * Mask credentials for safe display
   */
  maskCredentials(credentials: Record<string, any>): Record<string, any> {
    const schema = this.capabilities.credentialSchema ?? []
    const masked: Record<string, any> = {}

    for (const field of schema) {
      const value = credentials[field.variable]
      if (value !== undefined) {
        masked[field.variable] = ValidationUtils.maskCredentialValue(String(value), field.type)
      }
    }

    return masked
  }

  /**
   * Get credentials hash for cache key generation
   */
  getCredentialsHash(credentials: ProviderCredentials): string {
    return ValidationUtils.hashCredentials(credentials)
  }

  /**
   * Generate cache key for this provider and credentials
   */
  getCacheKey(operation: string, credentials?: ProviderCredentials): string {
    const base = `provider:${this.getProviderId()}:${this.organizationId}:${operation}`

    if (credentials) {
      const hash = this.getCredentialsHash(credentials)
      return `${base}:${hash}`
    }

    return base
  }

  // ===== GETTERS =====

  /**
   * Get the provider's unique identifier
   */
  getProviderId(): string {
    return this.capabilities.id!
  }

  /**
   * Get the provider's default model
   */
  getDefaultModel(): string {
    return this.capabilities.defaultModel
  }

  /**
   * Get the provider's rate limits
   */
  getRateLimits() {
    return this.capabilities.rateLimits
  }

  /**
   * Get list of required credential fields
   */
  getRequiredFields(): string[] {
    const schema = this.capabilities.credentialSchema ?? []
    return schema.filter((field) => field.required).map((field) => field.variable)
  }

  /**
   * Get all credential fields
   */
  getCredentialFields(): CredentialFormField[] {
    return this.capabilities.credentialSchema ?? []
  }

  /**
   * Get full provider capabilities
   */
  getCapabilities(): ProviderCapabilities {
    return this.capabilities
  }

  /**
   * Get provider display information
   */
  getDisplayInfo() {
    return {
      id: this.capabilities.id,
      displayName: this.capabilities.displayName,
      icon: this.capabilities.icon,
      color: this.capabilities.color,
      description: this.capabilities.description,
    }
  }

  // ===== PROTECTED HELPER METHODS =====

  /**
   * Extract a specific credential field using multiple naming patterns
   */
  protected extractCredentialField(credentials: Record<string, any>, fieldName: string): any {
    return ValidationUtils.extractCredentialField(credentials, fieldName, this.getProviderId())
  }

  /**
   * Log operation start
   */
  protected logOperationStart(operation: string, details?: Record<string, any>): void {
    this.logger.info(`Starting ${operation}`, {
      provider: this.getProviderId(),
      organizationId: this.organizationId,
      userId: this.userId,
      ...details,
    })
  }

  /**
   * Log operation success
   */
  protected logOperationSuccess(operation: string, details?: Record<string, any>): void {
    this.logger.info(`${operation} successful`, {
      provider: this.getProviderId(),
      organizationId: this.organizationId,
      ...details,
    })
  }

  /**
   * Log operation failure
   */
  protected logOperationError(operation: string, error: any, details?: Record<string, any>): void {
    this.logger.error(`${operation} failed`, {
      provider: this.getProviderId(),
      organizationId: this.organizationId,
      error: error instanceof Error ? error.message : String(error),
      ...details,
    })
  }
}
