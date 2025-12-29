// packages/lib/src/ai/providers/index.ts

// Core types and interfaces
export * from './types'

// Main service classes
export { ProviderConfigurationService } from './provider-configuration-service'
export { ProviderManager } from './provider-manager'
export { ProviderRegistry } from './provider-registry'
export { SystemModelService, type SystemModelDefaultEntity } from './system-model-service'

// Utility functions
export * from './utils'

// Re-export commonly used types for convenience
export type {
  ProviderConfiguration,
  ProviderConfigurations,
  ModelSettings,
  SystemConfiguration,
  CustomConfiguration,
  ProviderModelBundle,
  DefaultModelEntity,
  ModelWithProviderEntity,
} from './types'
