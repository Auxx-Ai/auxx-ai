// packages/lib/src/ai/providers/utility-model.ts

import { ProviderRegistry } from './provider-registry'
import { type ModelCapabilities, ModelType } from './types'

export interface ResolvedModel {
  provider: string
  model: string
}

/**
 * Derive the **utility model** — a cheap, same-provider sibling of the primary
 * model, used for low-stakes internal LLM tasks (procedure selection/routing,
 * goal-met & backstop checks, text-branch picking) where the agent's full
 * BYO-model tier is wasted. Customer-facing replies always keep running on the
 * primary; only internal plumbing drops to this tier.
 *
 * Fully auto-derived from the model registry — no config, no DB, no UI:
 *  - Already-cheap (tier-1) or unknown/custom primary → returned unchanged
 *    (nothing cheaper worth switching to).
 *  - Otherwise the newest tier-1 LLM **in the same provider family** that
 *    supports structured output (every internal caller relies on it). Staying in
 *    the primary's provider means the org already holds working credentials, so
 *    this can never hit a missing-creds wall the way a cross-provider pick would.
 *  - No suitable cheap sibling in the family → falls back to the primary.
 *
 * `creditMultiplier` is the tier proxy (1 = cheap/Haiku/mini/nano, 3 = Sonnet/
 * GPT-class, 5 = Opus); it defaults to 1 when unset (matches the registry).
 */
export function resolveUtilityModel(primary: ResolvedModel): ResolvedModel {
  const caps = ProviderRegistry.getModelCapabilities(primary.model)
  if (!caps || (caps.creditMultiplier ?? 1) === 1) return primary

  const candidates = ProviderRegistry.getAllModelsForProvider(primary.provider)
    .map((id) => ({ id, caps: ProviderRegistry.getModelCapabilities(id) }))
    .filter((c): c is { id: string; caps: ModelCapabilities } => c.caps !== null)
    .filter(
      ({ caps: c }) =>
        c.modelType === ModelType.LLM &&
        !c.deprecated &&
        !c.retired &&
        c.supports.structured &&
        (c.creditMultiplier ?? 1) === 1
    )
  if (candidates.length === 0) return primary

  // Newest first (releaseDate), then widest context, then stable by id — so the
  // pick auto-tracks the catalog (a newer Haiku/mini wins on its own) and is
  // deterministic across runs.
  candidates.sort(
    (a, b) =>
      (b.caps.releaseDate ?? '').localeCompare(a.caps.releaseDate ?? '') ||
      b.caps.contextLength - a.caps.contextLength ||
      a.id.localeCompare(b.id)
  )
  return { provider: primary.provider, model: candidates[0].id }
}
