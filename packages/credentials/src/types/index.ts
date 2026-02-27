// packages/credentials/src/types/index.ts

import type { ICredentialType, OAuth2Config } from '@auxx/workflow-nodes/types'

/**
 * Core credential management types
 */

/**
 * Provider authentication information
 * Compatible with storage adapter ProviderAuth interface
 */
export interface ProviderAuth {
  accessToken?: string
  refreshToken?: string
  expiresAt?: Date
  accountEmail?: string
  scopes?: string[]
  // Provider-specific fields (e.g., S3: region, secretKey)
  [key: string]: unknown
}

/**
 * Provider information and capabilities
 */
export interface ProviderInfo {
  providerId: string
  displayName: string
  category: string
  capabilities: ProviderCapabilities
  systemCredentialMapping?: Record<string, string>
  oauth2Config?: OAuth2Config
  hasConnectionTest: boolean
}

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  orgCredentials: boolean
  systemCredentials: boolean
  connectionTesting: boolean
  oauth2Support: boolean
}

/**
 * Validation result
 */
export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings?: ValidationWarning[]
}

export interface ValidationError {
  field: string
  message: string
  code?: string
}

export interface ValidationWarning {
  field: string
  message: string
  code?: string
}

/**
 * Connection test result
 */
export interface ConnectionTestResult {
  success: boolean
  latency?: number
  message: string
  metadata?: Record<string, unknown>
}

/**
 * Core interfaces for credential management
 */

export interface ICredentialTypeRegistry {
  // Provider registration and discovery
  getProvider(providerId: string): ICredentialType | null
  listProviders(): ICredentialType[]
  registerProvider(provider: ICredentialType): void

  // Provider metadata
  getProviderInfo(providerId: string): ProviderInfo | null
  getProvidersByCategory(category: string): ICredentialType[]

  // System credential support detection
  getProvidersWithSystemCredentials(): ICredentialType[]
  hasSystemCredentialSupport(providerId: string): boolean
}
