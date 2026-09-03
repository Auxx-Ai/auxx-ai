// packages/lib/src/companies/enrichment/guards.ts
// The whole "should we fetch this company's website right now?" policy, as one pure
// function over one plain state object.
//
// It lives apart from `enrich.ts` on purpose. Enrichment is reachable from four doors
// (record created, `company_domain` changed, `company_website` changed, manual/backfill)
// and two of them fire more often than they look:
//
//   1. The interactive field-trigger door presents a SENTINEL, not real values
//      (`field-hooks/field-hook-job.ts` — `INTERACTIVE_FIELD_WRITE` against
//      `oldValue: undefined`, "guaranteed unequal, so the transition always matches").
//      So a rule on `company_domain` fires on EVERY write of that field, including
//      clearing it and including re-saving the identical value.
//   2. `skipOnCreate` is honoured only on the interactive create path
//      (`field-hooks/collect-triggers.ts`). The sync door
//      (`events/handlers/handle-sync-record-rules.ts`) splits rules into field /
//      created / deleted buckets and never consults it, so an IMPORT that creates a
//      company carrying a domain fires the lifecycle rule AND the field rule for the
//      same record.
//
// No rule-declaration trick avoids either. The guard therefore sits in the work, and
// every door funnels through it.

import { domainFromWebsite } from './derive-domain'

/** Why enrichment was asked for. Only `'manual'` bypasses the freshness windows. */
export type EnrichReason = 'created' | 'domain-changed' | 'website-changed' | 'manual' | 'backfill'

/** The `company_enrichment_status` single-select options, as stored (`FieldValue.optionId`). */
export type EnrichmentStatus = 'pending' | 'enriched' | 'failed' | 'skipped'

/** Don't re-fetch a company we already enriched inside this window. */
export const ENRICHED_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Don't re-fetch a company whose site just failed. Shorter than the success window:
 * a 404 or a timeout is often transient, a successful enrichment rarely goes stale fast.
 */
export const FAILED_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Redis in-flight claim. Short: the durable guard is the stored status, not this. */
export const CLAIM_TTL_MS = 10 * 60 * 1000

/** Per-org outbound fetch budget. The backstop for a five-thousand-row import. */
export const ORG_WINDOW_LIMIT = 300
export const ORG_WINDOW_MS = 60 * 60 * 1000

/** Live record state the decision is made against. Read fresh, never taken from an event. */
export interface CompanyEnrichmentState {
  domain: string | null
  /** `company_website` is a multi-value URL field, so this is always a list. */
  website: string[]
  status: EnrichmentStatus | null
  enrichedAt: Date | null
  name: string | null
  notes: string | null
  /** The `asset:<id>` ref out of `company_logo`, or null when unset. */
  logoRef: string | null
}

export type EnrichSkipReason = 'no-domain' | 'recently-enriched' | 'recently-failed'

export type EnrichDecision =
  | { action: 'enrich'; domain: string; derivedFromWebsite: boolean }
  | {
      action: 'skip'
      why: EnrichSkipReason
      /** `'skipped'` writes the status so the gap is visible; null touches nothing. */
      writeStatus: 'skipped' | null
    }

/**
 * Decide whether to enrich, and against which domain.
 *
 * Order matters: the domain resolution runs first because a company with no domain and
 * no website is the single most common case (every company an import mints by name), and
 * it must cost nothing beyond the read that already happened.
 *
 * `'pending'` is deliberately NOT a skip reason. It is written just before the fetch, so
 * treating it as "in progress, stay away" would strand any company whose worker died
 * mid-fetch in a state nothing ever retries. Concurrency is handled by the BullMQ jobId
 * and the Redis claim instead, both of which expire on their own.
 */
export function shouldEnrich(
  state: CompanyEnrichmentState,
  reason: EnrichReason,
  now: Date
): EnrichDecision {
  const stored = state.domain?.trim().toLowerCase() || null
  const derived = stored ? null : domainFromWebsite(state.website)
  const domain = stored ?? derived

  if (!domain) {
    // Write the marker once, then leave the record alone. Without the second half, every
    // save of a domainless company would issue a pointless no-op update.
    return {
      action: 'skip',
      why: 'no-domain',
      writeStatus: state.status === 'skipped' ? null : 'skipped',
    }
  }

  if (reason !== 'manual' && state.enrichedAt) {
    const age = now.getTime() - state.enrichedAt.getTime()
    if (state.status === 'enriched' && age < ENRICHED_TTL_MS) {
      return { action: 'skip', why: 'recently-enriched', writeStatus: null }
    }
    if (state.status === 'failed' && age < FAILED_TTL_MS) {
      return { action: 'skip', why: 'recently-failed', writeStatus: null }
    }
  }

  return { action: 'enrich', domain, derivedFromWebsite: derived !== null }
}
