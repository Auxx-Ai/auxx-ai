// packages/lib/src/ai/quota/credit-multiplier.ts

import { ProviderRegistry } from '../providers/provider-registry'

export type CreditMultiplier = 1 | 3 | 5

/**
 * Heuristic tier classifier based on model ID.
 * Used as a fallback when a model registry entry doesn't declare `creditMultiplier`.
 */
function inferMultiplierFromModelId(model: string): CreditMultiplier {
  const id = model.toLowerCase()

  // Large tier (Opus, o1/o3 reasoning, Ultra)
  if (
    id.includes('opus') ||
    /\bo[134](?:-|$)/.test(id) ||
    id.includes('ultra') ||
    id.includes('gpt-5-pro')
  ) {
    return 5
  }

  // Small tier (Haiku, mini/nano, Flash, Lite)
  if (
    id.includes('haiku') ||
    id.includes('mini') ||
    id.includes('nano') ||
    id.includes('flash') ||
    id.includes('lite')
  ) {
    return 1
  }

  // Medium tier (Sonnet, GPT-4/5, Gemini Pro, everything else)
  return 3
}

/**
 * Return the credit multiplier for a SYSTEM LLM call.
 * 1 = small tier (Haiku, GPT-5 mini, Gemini Flash)
 * 3 = medium tier (Sonnet, GPT-5, Gemini Pro)
 * 5 = large tier (Opus, o3, Gemini Ultra)
 *
 * Looks up the explicit `creditMultiplier` in the model registry first.
 * Falls back to a name-based heuristic for models that haven't been tagged.
 */
export function getModelCreditMultiplier(_provider: string, model: string): CreditMultiplier {
  const capabilities = ProviderRegistry.getModelCapabilities(model)
  if (capabilities?.creditMultiplier) {
    return capabilities.creditMultiplier
  }
  return inferMultiplierFromModelId(model)
}
