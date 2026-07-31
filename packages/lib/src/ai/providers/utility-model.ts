// packages/lib/src/ai/providers/utility-model.ts

import { blendedCostPer1kTokens } from '../quota/model-cost'
import { ProviderRegistry } from './provider-registry'
import { type ModelCapabilities, ModelType } from './types'

export interface ResolvedModel {
  provider: string
  model: string
}

/**
 * Derive the **utility model** — a cheaper, same-provider sibling of the primary
 * model, used for low-stakes internal LLM tasks (procedure selection/routing,
 * goal-met & backstop checks, text-branch picking) where the agent's full
 * BYO-model tier is wasted. Customer-facing replies always keep running on the
 * primary; only internal plumbing drops to this tier.
 *
 * Fully auto-derived from the model registry — no config, no DB, no UI:
 *  - Unknown/unpriced/custom primary → returned unchanged (nothing comparable
 *    to switch to).
 *  - Otherwise the cheapest structured-output LLM **in the same provider family**
 *    (every internal caller relies on structured output). Staying in the
 *    primary's provider means the org already holds working credentials, so this
 *    can never hit a missing-creds wall the way a cross-provider pick would.
 *  - If the primary already is the cheapest such model → falls back to the
 *    primary.
 *
 * "Cheap" is measured by blended list price (90/10 input/output mix) — the same
 * signal the model-cost badge uses — replacing the old credit-multiplier tier.
 */
export function resolveUtilityModel(primary: ResolvedModel): ResolvedModel {
  const caps = ProviderRegistry.getModelCapabilities(primary.model)
  if (!caps?.costPer1kTokens) return primary
  const primaryBlended = blendedCostPer1kTokens(caps.costPer1kTokens)

  const candidates = ProviderRegistry.getAllModelsForProvider(primary.provider)
    .map((id) => ({ id, caps: ProviderRegistry.getModelCapabilities(id) }))
    .filter((c): c is { id: string; caps: ModelCapabilities } => c.caps !== null)
    .filter(
      ({ caps: c }) =>
        c.modelType === ModelType.LLM &&
        !c.deprecated &&
        !c.retired &&
        c.supports.structured &&
        !!c.costPer1kTokens
    )
  if (candidates.length === 0) return primary

  // Cheapest blended price first; tie-break newest (releaseDate), then widest
  // context, then stable by id — so the pick auto-tracks the catalog and is
  // deterministic across runs.
  candidates.sort(
    (a, b) =>
      blendedCostPer1kTokens(a.caps.costPer1kTokens!) -
        blendedCostPer1kTokens(b.caps.costPer1kTokens!) ||
      (b.caps.releaseDate ?? '').localeCompare(a.caps.releaseDate ?? '') ||
      b.caps.contextLength - a.caps.contextLength ||
      a.id.localeCompare(b.id)
  )

  const cheapest = candidates[0]
  if (!cheapest) return primary
  // Primary is already at/below the cheapest sibling → keep it.
  if (blendedCostPer1kTokens(cheapest.caps.costPer1kTokens!) >= primaryBlended) return primary
  return { provider: primary.provider, model: cheapest.id }
}
