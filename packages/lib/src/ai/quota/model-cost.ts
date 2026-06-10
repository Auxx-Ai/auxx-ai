// packages/lib/src/ai/quota/model-cost.ts

import { CREDIT_USD_VALUE } from './credit-conversion'

/**
 * Model list price per 1k tokens. Mirror of `ModelCapabilities.costPer1kTokens`
 * kept local so this module is client-safe (no provider-registry import).
 * Cached and long-context prices affect metering only; blended cost, credit
 * display, and tier badges use base-tier input/output.
 */
export interface CostPer1kTokens {
  input: number
  output: number
  cachedInput?: number
  cacheWrite?: number
  longContext?: Array<{
    over: number
    input: number
    output: number
    cachedInput?: number
    cacheWrite?: number
  }>
}

/** Relative price tier for the model-picker badge. */
export type CostTier = '$' | '$$' | '$$$'

/**
 * Blended list price per 1k tokens at a 90/10 input/output mix. Agent context
 * is overwhelmingly input, so this approximates real per-token cost better than
 * a flat average while staying a single comparable number.
 */
export function blendedCostPer1kTokens(cost: CostPer1kTokens): number {
  return cost.input * 0.9 + cost.output * 0.1
}

/** Credits charged per 1k input tokens — a clean integer at this conversion. */
export function creditsPer1kInputTokens(cost: CostPer1kTokens): number {
  return Math.round(cost.input / CREDIT_USD_VALUE)
}

/** Credits charged per 1k output tokens — a clean integer at this conversion. */
export function creditsPer1kOutputTokens(cost: CostPer1kTokens): number {
  return Math.round(cost.output / CREDIT_USD_VALUE)
}

/**
 * Blended-price thresholds (USD per 1k tokens) bucketing models into `$`/`$$`/`$$$`.
 * Open knob — tune before launch. Calibrated against the current registry:
 * nano/mini/Haiku → `$`, Sonnet/GPT-5.x/Gemini Pro → `$$`, Opus/Pro → `$$$`.
 */
const TIER_THRESHOLDS = { cheap: 0.002, mid: 0.01 } as const

/** Relative price tier bucketed from the blended list price. */
export function getModelCostTier(cost: CostPer1kTokens): CostTier {
  const blended = blendedCostPer1kTokens(cost)
  if (blended <= TIER_THRESHOLDS.cheap) return '$'
  if (blended <= TIER_THRESHOLDS.mid) return '$$'
  return '$$$'
}
