// packages/credentials/src/index.ts

// Export everything from manager
export * from './manager'
// Re-export commonly used items for convenience
export { CredentialManager } from './manager/credential-manager'
// Export everything from service
export * from './service'
export { CredentialService } from './service/credential-service'
export type {
  ConnectionTestResult,
  CredentialReference,
  ICredentialManager,
  ProviderAuth,
  ProviderInfo,
  SystemCredentialInfo,
  ValidationResult,
} from './types'
// Export everything from types
export * from './types'

import { CredentialManager } from './manager/credential-manager'
// Create singleton instance for convenience
export const credentialManager = new CredentialManager()

// Factory function for creating instances with specific configurations
export const createCredentialManager = () => new CredentialManager()

export type {
  ConfigKey,
  ConfigVariableDefinition,
  ConfigVariableGroupData,
  ResolvedConfigVariable,
} from './config'
// Config system
export {
  CONFIG_GROUP_META,
  CONFIG_VARIABLES,
  ConfigCache,
  ConfigService,
  ConfigStorage,
  configService,
  convertEnvValue,
  getAllConfigDefinitions,
  getConfigDefinition,
  getConfigDefinitionsByGroup,
  valueToString,
} from './config'
