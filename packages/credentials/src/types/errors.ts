// packages/lib/src/credentials/types/errors.ts

/**
 * Credential management error classes
 */

/**
 * Base error class for all credential-related errors
 */
export abstract class CredentialError extends Error {
  abstract readonly code: string
  context?: Record<string, unknown>

  constructor(message: string, context?: Record<string, unknown>) {
    super(message)
    this.name = this.constructor.name
    this.context = context

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

/**
 * Thrown when a credential provider is not found or not supported
 */
export class ProviderNotFoundError extends CredentialError {
  readonly code = 'PROVIDER_NOT_FOUND'
  readonly providerId: string

  constructor(providerId: string) {
    super(`Credential provider '${providerId}' not found or not supported`)
    this.providerId = providerId
  }
}

/**
 * Thrown when a specific credential is not found
 */
export class CredentialNotFoundError extends CredentialError {
  readonly code = 'CREDENTIAL_NOT_FOUND'
  readonly providerId: string
  readonly credentialId?: string

  constructor(providerId: string, credentialId?: string) {
    const message = credentialId
      ? `Credential '${credentialId}' not found for provider '${providerId}'`
      : `No credentials found for provider '${providerId}'`

    super(message)
    this.providerId = providerId
    this.credentialId = credentialId
  }
}

/**
 * Thrown when no credentials are available (neither org nor system)
 */
export class NoCredentialsAvailableError extends CredentialError {
  readonly code = 'NO_CREDENTIALS_AVAILABLE'
  readonly providerId: string

  constructor(providerId: string, details?: string) {
    const message = `No credentials available for provider '${providerId}'${details ? `: ${details}` : ''}`
    super(message)
    this.providerId = providerId
  }
}

/**
 * Thrown when system credentials are not available or missing required environment variables
 */
export class SystemCredentialNotAvailableError extends CredentialError {
  readonly code = 'SYSTEM_CREDENTIAL_NOT_AVAILABLE'
  readonly providerId: string
  readonly missingEnvVars: string[]

  constructor(providerId: string, missingEnvVars: string[]) {
    const message = `System credentials not available for provider '${providerId}'. Missing environment variables: ${missingEnvVars.join(', ')}`
    super(message)
    this.providerId = providerId
    this.missingEnvVars = missingEnvVars
  }
}

/**
 * Thrown when credential validation fails
 */
export class CredentialValidationError extends CredentialError {
  readonly code = 'CREDENTIAL_VALIDATION_FAILED'
  readonly providerId: string
  readonly validationErrors: Array<{ field: string; message: string }>

  constructor(providerId: string, validationErrors: Array<{ field: string; message: string }>) {
    const errorMessages = validationErrors.map((e) => `${e.field}: ${e.message}`).join(', ')
    super(`Credential validation failed for provider '${providerId}': ${errorMessages}`)
    this.providerId = providerId
    this.validationErrors = validationErrors
  }
}

/**
 * Thrown when credential connection test fails
 */
export class CredentialConnectionError extends CredentialError {
  readonly code = 'CREDENTIAL_CONNECTION_FAILED'
  readonly providerId: string
  readonly credentialId?: string

  constructor(providerId: string, originalError: Error, credentialId?: string) {
    const message = credentialId
      ? `Connection test failed for credential '${credentialId}' (provider: ${providerId}): ${originalError.message}`
      : `Connection test failed for provider '${providerId}': ${originalError.message}`

    super(message)
    this.providerId = providerId
    this.credentialId = credentialId
    this.context = { originalError: originalError.message }
  }
}

/**
 * Thrown when credential transformation fails
 */
export class CredentialTransformError extends CredentialError {
  readonly code = 'CREDENTIAL_TRANSFORM_FAILED'
  readonly providerId: string

  constructor(providerId: string, transformType: 'org' | 'system', originalError: Error) {
    super(
      `Failed to transform ${transformType} credential for provider '${providerId}': ${originalError.message}`
    )
    this.providerId = providerId
    this.context = { transformType, originalError: originalError.message }
  }
}

/**
 * Thrown when organization context is required but not provided
 */
export class OrganizationRequiredError extends CredentialError {
  readonly code = 'ORGANIZATION_REQUIRED'

  constructor(operation: string) {
    super(`Organization ID is required for operation: ${operation}`)
    this.context = { operation }
  }
}

/**
 * Thrown when an environment variable is required but not set
 */
export class RequiredEnvironmentVariableError extends CredentialError {
  readonly code = 'REQUIRED_ENV_VAR_MISSING'
  readonly envVarName: string

  constructor(envVarName: string, purpose?: string) {
    const message = purpose
      ? `Required environment variable '${envVarName}' is not set (needed for: ${purpose})`
      : `Required environment variable '${envVarName}' is not set`

    super(message)
    this.envVarName = envVarName
    this.context = { purpose }
  }
}

/**
 * Type guard to check if an error is a credential-related error
 */
export function isCredentialError(error: unknown): error is CredentialError {
  return error instanceof CredentialError
}

/**
 * Helper function to extract error details for logging/debugging
 */
export function getCredentialErrorDetails(error: CredentialError): Record<string, unknown> {
  return {
    name: error.name,
    code: error.code,
    message: error.message,
    context: error.context,
    // Include provider-specific fields if available
    ...('providerId' in error && { providerId: error.providerId }),
    ...('credentialId' in error && { credentialId: error.credentialId }),
    ...('missingEnvVars' in error && { missingEnvVars: error.missingEnvVars }),
    ...('validationErrors' in error && { validationErrors: error.validationErrors }),
  }
}
