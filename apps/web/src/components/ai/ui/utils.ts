// apps/web/src/app/(protected)/app/settings/aiModels/_components/utils.ts

// Import new types from ProviderManager - no more registry needed!
import type {
  ModelData as ProviderModelData,
  // ProviderData as ProviderProviderData,
  ProviderConfiguration,
} from '@auxx/lib/ai/providers/types'

export { FetchFrom } from '@auxx/lib/ai/providers/types'

// Re-export the clean types from ProviderManager
export type ModelData = ProviderModelData
export type { ProviderConfiguration, ProviderStatusInfo } from '@auxx/lib/ai/providers/types'
// export type ProviderData = ProviderProviderData & { capabilities: string[]; modelCount: number }

/**
 * Format context length with appropriate units
 */
export const formatContextLength = (contextLength: number): string => {
  if (contextLength >= 1000000) return `${Math.round(contextLength / 1000000)}M`
  if (contextLength >= 1000) return `${Math.round(contextLength / 1000)}K`
  return contextLength.toString()
}

/**
 * Get provider capabilities by aggregating all model features
 * Now using features directly from ModelData (no registry lookup needed!)
 */
export const getProviderCapabilities = (models: ModelData[]): string[] => {
  const allFeatures = new Set<string>()

  models.forEach((model) => {
    // Features are now directly available in ModelData
    model.features.forEach((feature) => allFeatures.add(feature))
  })

  // Sort capabilities for consistent display
  return Array.from(allFeatures).sort()
}

/**
 * Feature badge configuration mapping
 */
export const FEATURE_BADGES = {
  chat: { label: 'Chat', color: 'blue' },
  vision: { label: 'Vision', color: 'purple' },
  streaming: { label: 'Streaming', color: 'green' },
  structured: { label: 'JSON', color: 'orange' },
  embedding: { label: 'Embedding', color: 'cyan' },
  tts: { label: 'Speech', color: 'pink' },
  moderation: { label: 'Moderation', color: 'red' },
  rerank: { label: 'Rerank', color: 'indigo' },
} as const

/**
 * Process unified model data - now much simpler!
 * The new ProviderManager returns complete ModelData with all capabilities
 */
// export const processUnifiedModelData = (data: any): ProviderData[] => {
//   if (!data?.providers) return []

//   return data.providers.map((provider: any) => ({
//     ...provider,
//     // Add derived fields for compatibility
//     capabilities: getProviderCapabilities(provider.models || []),
//     modelCount: provider.models?.length || 0,
//     // Models already have complete data from ProviderManager - no transformation needed!
//   }))
// }
