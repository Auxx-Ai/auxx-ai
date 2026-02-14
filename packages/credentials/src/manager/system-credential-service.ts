// packages/credentials/src/manager/system-credential-service.ts

import { createScopedLogger } from '@auxx/logger'
import type { ICredentialType, OAuth2Config } from '@auxx/workflow-nodes/types'
import type {
  ISystemCredentialService,
  OAuth2SystemCredentials,
  SystemCredentialInfo,
  ValidationResult,
} from '../types'
import {
  RequiredEnvironmentVariableError,
  SystemCredentialNotAvailableError,
} from '../types/errors'
import type { CredentialTypeRegistry } from './credential-type-registry'

const logger = createScopedLogger('system-credential-service')

/**
 * Service for managing system-level credentials (environment variables, config files, etc.)
 */
export class SystemCredentialService implements ISystemCredentialService {
  private credentialTypeRegistry: CredentialTypeRegistry

  constructor(credentialTypeRegistry: CredentialTypeRegistry) {
    this.credentialTypeRegistry = credentialTypeRegistry
  }

  /**
   * Get system credentials for a provider
   */
  async getSystemCredentials(providerId: string): Promise<Record<string, string> | null> {
    const provider = this.credentialTypeRegistry.getProvider(providerId)
    if (!provider) {
      logger.warn('Provider not found for system credentials', { providerId })
      return null
    }

    // Get credentials directly from environment variables using provider's mapping
    const credentials = await this.getEnvironmentCredentials(providerId)
    if (credentials && Object.keys(credentials).length > 0) {
      logger.debug('Found system credentials from environment', {
        providerId,
        fieldCount: Object.keys(credentials).length,
      })
      return credentials
    }

    logger.debug('No system credentials found', { providerId })
    return null
  }

  /**
   * Check if system credentials are available for a provider
   */
  hasSystemCredentials(providerId: string): boolean {
    const provider = this.credentialTypeRegistry.getProvider(providerId)
    if (!provider) return false

    // Check for systemCredentialMapping
    const systemMapping = this.getSystemCredentialMapping(provider)
    if (systemMapping) {
      return this.hasRequiredEnvironmentVariables(systemMapping)
    }

    // Check for OAuth2 system client credentials
    const oauth2Config = this.getOAuth2Config(provider)
    if (oauth2Config?.systemClientIdEnv && oauth2Config?.systemClientSecretEnv) {
      return Boolean(
        process.env[oauth2Config.systemClientIdEnv] &&
          process.env[oauth2Config.systemClientSecretEnv]
      )
    }

    return false
  }

  /**
   * Validate system credentials for a provider
   */
  validateSystemCredentials(providerId: string): ValidationResult {
    const provider = this.credentialTypeRegistry.getProvider(providerId)
    if (!provider) {
      return {
        isValid: false,
        errors: [{ field: 'providerId', message: `Provider '${providerId}' not found` }],
      }
    }

    const errors: Array<{ field: string; message: string }> = []
    const warnings: Array<{ field: string; message: string }> = []

    // Validate systemCredentialMapping if present
    const systemMapping = this.getSystemCredentialMapping(provider)
    if (systemMapping) {
      for (const [fieldName, envVarName] of Object.entries(systemMapping)) {
        const value = process.env[envVarName]

        if (!value) {
          // Check if this field is required
          const property = provider.properties.find((p) => p.name === fieldName)
          if (property?.required) {
            errors.push({
              field: fieldName,
              message: `Required environment variable '${envVarName}' is not set`,
            })
          } else {
            warnings.push({
              field: fieldName,
              message: `Optional environment variable '${envVarName}' is not set`,
            })
          }
        } else {
          // Validate the value if we have validation rules
          const property = provider.properties.find((p) => p.name === fieldName)
          if (property?.validation) {
            const fieldValidation = this.validateFieldValue(value, property.validation)
            if (!fieldValidation.isValid) {
              errors.push({
                field: fieldName,
                message: `Environment variable '${envVarName}' validation failed: ${fieldValidation.error}`,
              })
            }
          }
        }
      }
    }

    // Validate OAuth2 system credentials if present
    const oauth2Config = this.getOAuth2Config(provider)
    if (oauth2Config) {
      if (oauth2Config.systemClientIdEnv && !process.env[oauth2Config.systemClientIdEnv]) {
        errors.push({
          field: 'clientId',
          message: `Required environment variable '${oauth2Config.systemClientIdEnv}' is not set`,
        })
      }

      if (oauth2Config.systemClientSecretEnv && !process.env[oauth2Config.systemClientSecretEnv]) {
        errors.push({
          field: 'clientSecret',
          message: `Required environment variable '${oauth2Config.systemClientSecretEnv}' is not set`,
        })
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  /**
   * List all available system credentials
   */
  async listAvailableSystemCredentials(): Promise<SystemCredentialInfo[]> {
    const systemCredentials: SystemCredentialInfo[] = []

    for (const provider of this.credentialTypeRegistry.listProviders()) {
      if (this.credentialTypeRegistry.hasSystemCredentialSupport(provider.name)) {
        const validation = this.validateSystemCredentials(provider.name)
        const missingEnvVars = validation.errors
          .filter((error) => error.message.includes('environment variable'))
          .map((error) => {
            const match = error.message.match(/'([^']+)'/)
            return match?.[1]
          })
          .filter((x): x is string => Boolean(x))

        systemCredentials.push({
          providerId: provider.name,
          displayName: provider.displayName,
          available: validation.isValid,
          missingEnvVars: missingEnvVars.length > 0 ? missingEnvVars : undefined,
          source: 'environment', // Currently only support environment
        })
      }
    }

    return systemCredentials
  }

  /**
   * Get OAuth2 system credentials
   */
  async getOAuth2SystemCredentials(
    oauth2Config: OAuth2Config
  ): Promise<OAuth2SystemCredentials | null> {
    if (!oauth2Config.systemClientIdEnv || !oauth2Config.systemClientSecretEnv) {
      return null
    }

    const clientId = this.getOptionalEnvVar(oauth2Config.systemClientIdEnv)
    const clientSecret = this.getOptionalEnvVar(oauth2Config.systemClientSecretEnv)

    if (!clientId || !clientSecret) {
      return null
    }

    return {
      clientId,
      clientSecret,
      scopes: oauth2Config.scopes || [],
      authUrl: oauth2Config.authUrl,
      tokenUrl: oauth2Config.tokenUrl,
      // RedirectUri might be configured separately
      redirectUri: this.getOptionalEnvVar('OAUTH2_REDIRECT_URI'),
    }
  }

  /**
   * Get required environment variable
   */
  getRequiredEnvVar(key: string): string {
    const value = process.env[key]
    if (!value) {
      throw new RequiredEnvironmentVariableError(key)
    }
    return value
  }

  /**
   * Get optional environment variable
   */
  getOptionalEnvVar(key: string, defaultValue?: string): string | undefined {
    return process.env[key] || defaultValue
  }

  /**
   * Get all credential sources (simplified - only environment)
   */
  getCredentialSources(): string[] {
    return ['environment']
  }

  /**
   * Get credentials from environment variables
   */
  private async getEnvironmentCredentials(
    providerId: string
  ): Promise<Record<string, string> | null> {
    const provider = this.credentialTypeRegistry.getProvider(providerId)
    if (!provider) return null

    const credentials: Record<string, string> = {}

    // Handle systemCredentialMapping (required credentials)
    const systemMapping = this.getSystemCredentialMapping(provider)
    if (systemMapping) {
      for (const [fieldName, envVarName] of Object.entries(systemMapping)) {
        const value = process.env[envVarName]
        if (value) {
          credentials[fieldName] = value
        }
      }
    }

    // Handle optionalSystemCredentialMapping (optional credentials)
    const optionalMapping = this.getOptionalSystemCredentialMapping(provider)
    if (optionalMapping) {
      for (const [fieldName, envVarName] of Object.entries(optionalMapping)) {
        const value = process.env[envVarName]
        if (value) {
          credentials[fieldName] = value
        }
      }
    }

    // Handle OAuth2 system credentials
    const oauth2Config = this.getOAuth2Config(provider)
    if (oauth2Config?.systemClientIdEnv && oauth2Config?.systemClientSecretEnv) {
      const clientId = process.env[oauth2Config.systemClientIdEnv]
      const clientSecret = process.env[oauth2Config.systemClientSecretEnv]

      if (clientId && clientSecret) {
        credentials.clientId = clientId
        credentials.clientSecret = clientSecret
      }
    }

    return Object.keys(credentials).length > 0 ? credentials : null
  }

  /**
   * Check if all required environment variables are available
   */
  private hasRequiredEnvironmentVariables(systemMapping: Record<string, string>): boolean {
    const results: Record<string, boolean> = {}
    let allPresent = true

    for (const [key, envVarName] of Object.entries(systemMapping)) {
      const isPresent = Boolean(process.env[envVarName])
      results[key] = isPresent
      if (!isPresent) {
        allPresent = false
      }
    }

    return allPresent
  }

  /**
   * Get system credential mapping from provider
   */
  private getSystemCredentialMapping(
    provider: ICredentialType
  ): Record<string, string> | undefined {
    return (provider as any).systemCredentialMapping
  }

  /**
   * Get optional system credential mapping from provider
   */
  private getOptionalSystemCredentialMapping(
    provider: ICredentialType
  ): Record<string, string> | undefined {
    return (provider as any).optionalSystemCredentialMapping
  }

  /**
   * Get OAuth2 config from provider
   */
  private getOAuth2Config(provider: ICredentialType): OAuth2Config | undefined {
    return (provider as any).oauth2Config
  }

  /**
   * Validate a field value against validation rules
   */
  private validateFieldValue(value: string, validation: any): { isValid: boolean; error?: string } {
    // Basic validation - can be extended based on validation rules
    if (validation.minLength && value.length < validation.minLength) {
      return {
        isValid: false,
        error: `Must be at least ${validation.minLength} characters`,
      }
    }

    if (validation.maxLength && value.length > validation.maxLength) {
      return {
        isValid: false,
        error: `Must be no more than ${validation.maxLength} characters`,
      }
    }

    if (validation.pattern) {
      const pattern =
        typeof validation.pattern === 'string' ? new RegExp(validation.pattern) : validation.pattern

      if (!pattern.test(value)) {
        return {
          isValid: false,
          error: validation.errorMessage || 'Format is invalid',
        }
      }
    }

    if (validation.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(value)) {
        return {
          isValid: false,
          error: 'Must be a valid email address',
        }
      }
    }

    if (validation.url) {
      try {
        new URL(value)
      } catch {
        return {
          isValid: false,
          error: 'Must be a valid URL',
        }
      }
    }

    return { isValid: true }
  }
}
