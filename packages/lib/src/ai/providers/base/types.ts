// packages/lib/src/ai/providers/base/types.ts

export enum ModelType {
  LLM = 'LLM',
  TEXT_EMBEDDING = 'TEXT_EMBEDDING',
  TTS = 'TTS',
  VISION = 'VISION',
  IMAGE_GENERATION = 'IMAGE_GENERATION',
  AUDIO_TRANSCRIPTION = 'AUDIO_TRANSCRIPTION',
}

export interface RateLimits {
  requestsPerMinute?: number
  tokensPerMinute?: number
  requestsPerDay?: number
  cacheTtl?: number // Cache TTL in seconds
}

export interface ValidationResult {
  isValid: boolean
  error?: string
  details?: Record<string, any>
}

export interface SchemaValidationResult {
  isValid: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

export interface ConnectionTestResult {
  success: boolean
  responseTime?: number
  error?: string
  modelsTested?: string[]
  details?: Record<string, any>
}

export interface ProviderCredentials {
  [key: string]: string | number | boolean | undefined
}

export interface CacheOptions {
  ttl?: number
  tags?: string[]
}

// Error types
export class ProviderError extends Error {
  constructor(
    message: string,
    public providerId: string,
    public code: string = 'PROVIDER_ERROR'
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export class CredentialValidationError extends ProviderError {
  constructor(
    message: string,
    providerId: string,
    public field: string = 'credentials'
  ) {
    super(message, providerId, 'CREDENTIAL_VALIDATION_ERROR')
    this.name = 'CredentialValidationError'
  }
}

export class ConnectionTestError extends ProviderError {
  constructor(
    message: string,
    providerId: string,
    public responseTime?: number
  ) {
    super(message, providerId, 'CONNECTION_TEST_ERROR')
    this.name = 'ConnectionTestError'
  }
}

export class ProviderConfigurationError extends ProviderError {
  constructor(
    message: string,
    providerId: string,
    public operationType: string = 'UNKNOWN'
  ) {
    super(message, providerId, 'PROVIDER_CONFIGURATION_ERROR')
    this.name = 'ProviderConfigurationError'
  }
}
