// packages/lib/src/ai/providers/config/model-params.ts

import { ProviderRegistry } from '../provider-registry'
import type { AiProviderCtx } from './context'
import { getModelConfiguration } from './queries'

/**
 * Default parameter configuration for a model, extracted from ModelRegistry capabilities.
 * Used when creating new model configurations or resetting to defaults.
 */
export function getDefaultModelConfig(modelName: string): Record<string, any> {
  const modelCaps = ProviderRegistry.getModelCapabilities(modelName)
  if (!modelCaps?.parameterRules) return {}

  const defaultConfig: Record<string, any> = {}
  for (const rule of modelCaps.parameterRules) {
    if (rule.default !== null && rule.default !== undefined) {
      defaultConfig[rule.name] = rule.default
    }
  }
  return defaultConfig
}

/**
 * Effective configuration for a model — registry defaults merged with the org's stored
 * overrides (user config takes precedence). Read-only, registry-merged: no cache event.
 */
export async function getEffectiveConfig(
  ctx: AiProviderCtx,
  provider: string,
  model: string,
  modelType = 'llm'
): Promise<Record<string, any>> {
  const modelConfig = await getModelConfiguration(ctx, provider, model, modelType)
  const defaultConfig = getDefaultModelConfig(model)
  return { ...defaultConfig, ...(modelConfig?.config || {}) }
}
