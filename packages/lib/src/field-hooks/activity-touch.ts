// packages/lib/src/field-hooks/activity-touch.ts
//
// Which field writes count as record ACTIVITY (`EntityInstance.lastActivityAt`).
// The touch itself is a column of the write path's single derived-column
// flush (`field-values/instance-derived.ts`), one per record write; this
// module only answers whether a given field should advance it. It used to be
// a global post-hook that ran one UPDATE per field on the pool connection.

import type { CachedField } from '../field-values/field-value-helpers'

/**
 * Field systemAttributes that should NOT advance `lastActivityAt` when
 * written. These represent system-managed bookkeeping (background
 * enrichment, AI override), not real activity.
 *
 * - `nextActionOverride` (Phase 4): setting the override IS the next action;
 *   re-firing on its own write would be a feedback loop.
 * - `company_enriched_at`, `company_enrichment_status`: written by the
 *   background company-enrichment trigger, not by users or AI.
 *
 * Custom-field signal: any field with `hidden: true, creatable: false,
 * updatable: true` is also system-managed by convention. We don't dynamically
 * walk the registry yet, which keeps startup cheap and the skip-set explicit.
 */
const SKIPPED_SYSTEM_ATTRIBUTES = new Set<string>([
  'nextActionOverride',
  'company_enriched_at',
  'company_enrichment_status',
])

/**
 * True when a real change to this field is activity on the record. AI-driven
 * writes (kopilot's `bulk_update_entity`) flow through the same mutation path
 * as user edits, so they count too: AI writes are real activity.
 */
export function fieldTouchesActivity(field: Pick<CachedField, 'systemAttribute'>): boolean {
  const attr = (field as { systemAttribute?: string | null }).systemAttribute
  return !(attr && SKIPPED_SYSTEM_ATTRIBUTES.has(attr))
}
