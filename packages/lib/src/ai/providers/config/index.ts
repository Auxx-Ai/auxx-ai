// packages/lib/src/ai/providers/config/index.ts

// Public write API (write-then-invalidate)
export {
  deleteCustomModel,
  deleteProvider,
  listProviderKeys,
  removeCustomCredentials,
  saveCustomModel,
  saveProvider,
  setProviderDefaultKey,
  switchProviderType,
  testProvider,
  toggleModel,
  updateModelConfig,
} from './actions'
// Compute layer (DB-direct) — consumed by cache compute providers
export { computeProviderConfig, computeProviderConfigs } from './assemble'
export type { ProviderCredentialSummary } from './byo-store'
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
