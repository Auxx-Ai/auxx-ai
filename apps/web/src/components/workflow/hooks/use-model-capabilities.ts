// apps/web/src/components/workflow/hooks/use-model-capabilities.ts
'use client'

import type { ModelData } from '@auxx/lib/ai/providers/types'
import { useMemo } from 'react'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api, type RouterOutputs } from '~/trpc/react'

type UnifiedModelData = RouterOutputs['aiIntegration']['getUnifiedModelData']

/** The AI-node model reference shape (`nodeData.model`). */
export interface ModelCapabilitiesRef {
  provider?: string
  name?: string
  useDefault?: boolean
}

export interface ModelCapabilitiesResult {
  /** The resolved model entry, or undefined when it can't be resolved. */
  model: ModelData | undefined
  /**
   * The resolved model's capability flags. Undefined when the model isn't
   * resolved — treat as "everything supported" (fail open, same as runtime).
   * A feature is unsupported ONLY when its flag is explicitly `false`.
   */
  supports: ModelData['supports'] | undefined
  /** Human-readable model name for hints ("Not supported by DeepSeek Chat"). */
  displayName: string | undefined
}

const UNRESOLVED: ModelCapabilitiesResult = {
  model: undefined,
  supports: undefined,
  displayName: undefined,
}

function findModel(
  data: UnifiedModelData,
  provider: string,
  modelId: string
): ModelData | undefined {
  const providerData = data.providers.find((p) => p.provider === provider)
  return providerData?.models.find((m) => m.modelId === modelId) as ModelData | undefined
}

/**
 * Pure resolution logic behind `useModelCapabilities` — exported for unit
 * tests. `useDefault` resolves via `defaultModels.llm`, falling back to the
 * `isDefault` flag on chat-capable models; explicit refs match
 * provider + modelId. Unresolvable refs return the unresolved result
 * (everything supported).
 */
export function resolveModelCapabilities(
  data: UnifiedModelData | undefined,
  model: ModelCapabilitiesRef | undefined
): ModelCapabilitiesResult {
  if (!data || !model) return UNRESOLVED

  let resolved: ModelData | undefined
  if (model.useDefault) {
    const def = data.defaultModels?.llm
    if (def) resolved = findModel(data, def.provider, def.model)
    if (!resolved) {
      for (const provider of data.providers) {
        resolved = provider.models.find((m) => m.isDefault && m.features.includes('chat')) as
          | ModelData
          | undefined
        if (resolved) break
      }
    }
  } else if (model.provider && model.name) {
    resolved = findModel(data, model.provider, model.name)
  }

  if (!resolved) return UNRESOLVED
  return { model: resolved, supports: resolved.supports, displayName: resolved.displayName }
}

/**
 * Resolve the capability flags of the model an AI node is configured to use.
 * Reuses the already-cached `getUnifiedModelData` query (same input as the
 * workflow init / model picker, so react-query shares the cache entry).
 *
 * Gating rule: a feature is unsupported ONLY when `supports.<flag> === false`.
 * Unknown models (custom/BYO with `supports: {}`) and unresolved refs fail
 * open — everything reads as supported, matching runtime behavior.
 */
export function useModelCapabilities(model?: ModelCapabilitiesRef): ModelCapabilitiesResult {
  const { data } = api.aiIntegration.getUnifiedModelData.useQuery(
    { includeDefaults: true },
    { staleTime: ORG_STATIC_STALE_TIME }
  )

  return useMemo(() => resolveModelCapabilities(data, model), [data, model])
}
