// packages/lib/src/utils/rate-limiter/quota.ts
// The partition key for shared pacing: *what* the upstream actually meters.
//
// Every provider meters something different — Quo meters the API key (workspace),
// Shopify the shop domain, Gmail the project + user. Getting that partition wrong is
// the difference between "one shared budget" and "N processes 429ing each other", so
// it is declared explicitly here rather than being implied by whatever id happened to
// be in scope at the call site.

import { createHash } from 'node:crypto'
import type { IntegrationProviderType } from '@auxx/database/types'
import { ENHANCED_PROVIDER_LIMITS } from './provider-configs'

/** What the upstream meters. Names the *dimension*, not the id we happen to hold. */
export type QuotaScope = 'apiKey' | 'account' | 'shop' | 'connection'

/**
 * One metered budget. `provider` + `scope` + `scopeId` form the Redis cursor key, so
 * two callers agreeing on all three share a budget and everyone else is isolated.
 */
export interface Quota {
  /** Key namespace — an `IntegrationProviderType` for channels, `'connection'` for connectors. */
  provider: string
  scope: QuotaScope
  /** Hash for secrets (see {@link hashScopeId}), a plain id otherwise. */
  scopeId: string
  /** Sustained requests per second across every process sharing this quota. */
  rps: number
  /**
   * How far ahead of `now` a reservation may land before it is refused instead of
   * slept. Doubles as the caller's maximum wait: a `Retry-After` past this ceiling
   * surfaces as a `RateLimitError` rather than parking a worker.
   */
  burstMs: number
}

/** Look-ahead ceiling when a caller doesn't pick one. 30s ≈ the longest a worker job
 *  should ever block on pacing before yielding. */
export const DEFAULT_BURST_MS = 30_000

/** Fallback rate for a provider whose `requestsPerSecond` isn't declared. Deliberately
 *  conservative — an undeclared limit is an unknown limit. */
export const DEFAULT_RPS = 5

/** Pacing rate for a connector connection, which declares no provider limits of its
 *  own. High enough to be a no-op for a healthy backfill; low enough that two
 *  concurrent slices on one connection can't stampede an upstream. */
export const DEFAULT_CONNECTION_RPS = 10

/**
 * Derive a stable, non-reversible scope id from a secret (an API key, a token).
 *
 * Hashing the metered secret rather than the row that stores it is both cheaper and
 * more correct: two `Credential` rows can hold the same API key, and keying on the row
 * id would hand one upstream workspace two budgets — which is exactly how you 429
 * yourself. 16 hex chars is 64 bits; collisions across one org's credentials are not a
 * practical concern, and no raw secret reaches Redis.
 */
export function hashScopeId(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16)
}

/** The Redis key holding this quota's shared slot cursor. */
export function quotaCursorKey(quota: Quota): string {
  return `pace:${quota.provider}:${quota.scope}:${quota.scopeId}`
}

/**
 * Build a {@link Quota} for an integration provider, reading the sustained rate from
 * `ENHANCED_PROVIDER_LIMITS[provider].requestsPerSecond` — which is what makes
 * `provider-configs.ts` load-bearing instead of decorative.
 *
 * @param provider - The metering upstream.
 * @param scope - What that upstream meters.
 * @param scopeId - The identity within that scope; hash it first if it's a secret.
 * @param overrides - Explicit `rps` / `burstMs`, for callers that know better.
 */
export function resolveQuota(
  provider: IntegrationProviderType,
  scope: QuotaScope,
  scopeId: string,
  overrides: { rps?: number; burstMs?: number } = {}
): Quota {
  const declared = ENHANCED_PROVIDER_LIMITS[provider]?.requestsPerSecond
  return {
    provider,
    scope,
    scopeId,
    rps: overrides.rps ?? declared ?? DEFAULT_RPS,
    burstMs: overrides.burstMs ?? DEFAULT_BURST_MS,
  }
}

/**
 * Build a {@link Quota} for a data-connector connection. Connections have no provider
 * limits table, so the rate is either supplied by the caller (from the endpoint's
 * rate-limit policy) or falls back to {@link DEFAULT_CONNECTION_RPS}.
 */
export function connectionQuota(
  connectionId: string,
  overrides: { rps?: number; burstMs?: number } = {}
): Quota {
  return {
    provider: 'connection',
    scope: 'connection',
    scopeId: connectionId,
    rps: overrides.rps ?? DEFAULT_CONNECTION_RPS,
    burstMs: overrides.burstMs ?? DEFAULT_BURST_MS,
  }
}
