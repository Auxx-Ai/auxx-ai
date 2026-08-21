// packages/lib/src/ai/providers/config/context.ts

import type { Database } from '@auxx/database'

/**
 * Explicit context threaded through every AI provider config function in place of `this`.
 * `userId` is `'system'` on cache-compute paths and the real user on tRPC/mutation paths.
 */
export type AiProviderCtx = {
  db: Database
  organizationId: string
  userId: string
}

/**
 * Providers that support system (platform-managed) credentials.
 * Only these providers can resolve API keys from environment variables for SYSTEM mode.
 * Must match the providers seeded in organization-seeder.ts.
 */
export const SYSTEM_ELIGIBLE_PROVIDERS = new Set(['anthropic', 'openai'])

/**
 * Providers whose standard API terms forbid training on submitted data.
 *
 * The Google Workspace API User Data and Developer Policy (Limited Use) bars transferring
 * Workspace data — raw, aggregated, anonymized or derived — to third parties that use it to
 * train generalized AI/ML models. An org with a connected Google account may therefore only
 * reach providers on this list. See `plans/google-limited-use-provider-gate.md`.
 *
 * `google` belongs here only on the PAID Gemini tier; the free AI Studio tier trains on
 * prompts. Re-check before adding a provider — this list is a compliance assertion.
 */
export const LIMITED_USE_SAFE_PROVIDERS = new Set(['openai', 'anthropic', 'google'])

/**
 * Whether a provider is blocked for an org, given the org's already-resolved gate state.
 * Pure — both the read layer and the client factory resolve `gated` their own way (see
 * `limited-use.ts`) and share this decision so the two can never diverge.
 */
export function isProviderLimitedUseBlocked(providerId: string, gated: boolean): boolean {
  return gated && !LIMITED_USE_SAFE_PROVIDERS.has(providerId)
}
