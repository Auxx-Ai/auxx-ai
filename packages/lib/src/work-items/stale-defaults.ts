// packages/lib/src/work-items/stale-defaults.ts

/**
 * Per-entity-slug staleness defaults used by the AI suggestion scanner
 * (Phase 3c). Phase 2 was deferred — the originally planned per-template
 * metadata + admin override layers are not in v1, so the scanner reads from
 * this hardcoded table directly.
 *
 * When Phase 2 ships, this file becomes the fallback layer: lookups go
 * `template metadata → org admin override → STALE_AFTER_DAYS`.
 */

/** Days of inactivity after which an entity becomes a scanner candidate. */
export const STALE_AFTER_DAYS: Record<string, number> = {
  deals: 7,
  leads: 5,
  tickets: 2,
}

/** Default for slugs not in `STALE_AFTER_DAYS`. */
export const DEFAULT_STALE_DAYS = 7

/**
 * Per-entity-slug stage `value`s that are terminal — entities in these stages
 * never produce AI bundles. The scanner's candidate query excludes them via a
 * `CustomFieldValue.value::text = ANY ($terminalStageValues)` predicate.
 *
 * Default empty set for slugs not listed.
 */
export const TERMINAL_STAGES: Record<string, ReadonlySet<string>> = {
  deals: new Set(['closed-won', 'closed-lost']),
  leads: new Set(['qualified', 'unqualified']),
  tickets: new Set(['resolved', 'closed']),
}

const EMPTY_STAGES: ReadonlySet<string> = new Set()

export function getStaleAfterDays(apiSlug: string): number {
  return STALE_AFTER_DAYS[apiSlug] ?? DEFAULT_STALE_DAYS
}

export function getTerminalStages(apiSlug: string): ReadonlySet<string> {
  return TERMINAL_STAGES[apiSlug] ?? EMPTY_STAGES
}

/**
 * The set of entity slugs the scanner sweeps every tick. Kept narrow on
 * purpose — sweeping every entity type in v1 would burn tokens without
 * validated demand. New slugs land here as the product matures.
 */
export const SCANNED_ENTITY_SLUGS: readonly string[] = ['deals', 'leads', 'tickets']
