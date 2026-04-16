// packages/credentials/src/index.ts

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
  configService,
  convertEnvValue,
  getAllConfigDefinitions,
  getConfigDefinition,
  getConfigDefinitionsByGroup,
  valueToString,
} from './config'
export { ConfigStorage } from './config/config-storage'
export type { LoginTokenError, LoginTokenPayload, VerifiedLoginToken } from './login-token'
// Login token
export { issueLoginToken, verifyLoginToken } from './login-token'
// Export everything from manager
export * from './manager'
// Export everything from service
export * from './service'
export { CredentialService } from './service/credential-service'
export type {
  ConnectionTestResult,
  ProviderAuth,
  ProviderInfo,
  ValidationResult,
} from './types'
// Export everything from types
export * from './types'
