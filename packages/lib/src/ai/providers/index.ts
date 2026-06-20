// packages/lib/src/ai/providers/index.ts

// Functional provider config layer (replaces ProviderConfigurationService + ProviderManager)
export type { AiProviderCtx } from './config'
export {
  computeProviderConfig,
  computeProviderConfigs,
  deleteCustomModel,
  deleteProvider,
  getCredentials,
  getEffectiveConfig,
  getModelTypeForModel,
  getProviderConfig,
  getProviderConfigs,
  getSystemCredentials,
  getUnifiedModelData,
  isModelCompatible,
  removeCustomCredentials,
  resolveCredentials,
  saveCustomModel,
  saveProvider,
  switchProviderType,
  testProvider,
  toggleModel,
  updateModelConfig,
} from './config'
// Connection blueprint mapping
export {
  AI_PROVIDER_CONNECTION_KEY,
  AI_SYSTEM_ENV_MAP,
  aiProviderConnectionKey,
  CONNECTION_KEY_AI_PROVIDER,
} from './connection-provider-map'
export { ProviderRegistry } from './provider-registry'
export { type SystemModelDefaultEntity, SystemModelService } from './system-model-service'
// Re-export commonly used types for convenience
export type {
  CustomConfiguration,
  DefaultModelEntity,
  ModelSettings,
  ModelWithProviderEntity,
  ProviderConfiguration,
  ProviderConfigurations,
  ProviderModelBundle,
  SystemConfiguration,
} from './types'
// Core types and interfaces
export * from './types'
// Utility functions
export * from './utils'
