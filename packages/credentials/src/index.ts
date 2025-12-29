// packages/credentials/src/index.ts

// Export everything from manager
export * from './manager'

// Export everything from service
export * from './service'

// Export everything from types
export * from './types'

// Re-export commonly used items for convenience
export { CredentialManager } from './manager/credential-manager'
export { CredentialService } from './service/credential-service'
export type {
  ICredentialManager,
  ProviderAuth,
  ProviderInfo,
  CredentialReference,
  SystemCredentialInfo,
  ConnectionTestResult,
  ValidationResult,
} from './types'

import { CredentialManager } from './manager/credential-manager'
// Create singleton instance for convenience
export const credentialManager = new CredentialManager()

// Factory function for creating instances with specific configurations
export const createCredentialManager = () => new CredentialManager()
