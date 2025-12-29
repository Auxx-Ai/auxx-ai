// packages/credentials/src/types/index.ts

import type { ICredentialType, NodeData } from '@auxx/workflow-nodes/types'
import type { OAuth2Config } from '@auxx/workflow-nodes/types'

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
 * Credential reference for listing operations
 */
export interface CredentialReference {
  id: string
  name: string
  type: 'org' | 'system'
  providerId: string
  organizationId?: string
  metadata?: CredentialMetadata
}

/**
 * System credential information
 */
export interface SystemCredentialInfo {
  providerId: string
  displayName: string
  available: boolean
  missingEnvVars?: string[]
  source: 'environment' | 'config' | 'secrets-manager'
}

/**
 * Credential metadata
 */
export interface CredentialMetadata {
  description?: string
  tags?: string[]
  environment?: 'development' | 'staging' | 'production'
  lastUsed?: Date
  createdBy?: string
  expiresAt?: Date
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
 * OAuth2 system credentials
 */
export interface OAuth2SystemCredentials {
  clientId: string
  clientSecret: string
  scopes: string[]
  authUrl: string
  tokenUrl: string
  redirectUri?: string
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

export interface ISystemCredentialService {
  // Core credential access
  getSystemCredentials(providerId: string): Promise<Record<string, string> | null>
  hasSystemCredentials(providerId: string): boolean
  
  // Validation and testing
  validateSystemCredentials(providerId: string): ValidationResult
  listAvailableSystemCredentials(): Promise<SystemCredentialInfo[]>
  
  // Environment variable helpers
  getRequiredEnvVar(key: string): string
  getOptionalEnvVar(key: string, defaultValue?: string): string | undefined
  
  // OAuth2 system credentials
  getOAuth2SystemCredentials(oauth2Config: OAuth2Config): Promise<OAuth2SystemCredentials | null>
  
  // System credential sources (simplified)
  getCredentialSources(): string[]
}

export interface IOrgCredentialService {
  // Existing CredentialService methods
  loadCredential(credentialId: string, organizationId: string): Promise<NodeData>
  
  // CredentialManager integration
  getCredentialsByProvider(providerId: string, organizationId: string): Promise<CredentialReference[]>
  getCredentialWithProviderInfo(credentialId: string, organizationId: string): Promise<{
    credential: NodeData
    providerInfo: ProviderInfo
  }>
  
  // Enhanced metadata
  getCredentialMetadata(credentialId: string): Promise<CredentialMetadata>
  updateCredentialMetadata(credentialId: string, metadata: Partial<CredentialMetadata>): Promise<void>
}

export interface ICredentialManager {
  // Primary credential resolution
  getCredentials(providerId: string, organizationId?: string, credentialId?: string): Promise<ProviderAuth>
  
  // System credential availability
  hasSystemCredentials(providerId: string): boolean
  listSystemCredentials(): Promise<SystemCredentialInfo[]>
  
  // Organization credential management
  listOrgCredentials(providerId: string, organizationId: string): Promise<CredentialReference[]>
  
  // Testing and validation
  testCredentials(providerId: string, credentialId?: string, organizationId?: string): Promise<ConnectionTestResult>
  validateCredentials(providerId: string, credentialData: unknown): Promise<ValidationResult>
  
  // Provider information
  getProviderInfo(providerId: string): ProviderInfo | null
  listSupportedProviders(): ProviderInfo[]
}