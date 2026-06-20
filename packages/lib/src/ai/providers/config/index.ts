// packages/lib/src/ai/providers/config/index.ts

// Public write API (write-then-invalidate)
export {
  deleteCustomModel,
  deleteProvider,
  removeCustomCredentials,
  saveCustomModel,
  saveProvider,
  switchProviderType,
  testProvider,
  toggleModel,
  updateModelConfig,
} from './actions'
// Compute layer (DB-direct) — consumed by cache compute providers
export { computeProviderConfig, computeProviderConfigs } from './assemble'
// Public read API (cache-backed)
export {
  getCredentials,
  getModelTypeForModel,
  getProviderConfig,
  getProviderConfigs,
  getSystemCredentials,
  getUnifiedModelData,
  isModelCompatible,
} from './cache'
export type { AiProviderCtx } from './context'
export { getEffectiveConfig } from './model-params'
export { resolveCredentials } from './runtime-credentials'
