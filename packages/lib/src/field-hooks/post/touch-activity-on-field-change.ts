// packages/lib/src/field-hooks/post/touch-activity-on-field-change.ts

import { getInstanceId } from '@auxx/types/resource'
import { touchEntityActivity } from '../../entity-instances/activity'
import type { EntityFieldChangeHandler } from '../types'

/**
 * Field systemAttributes that should NOT advance `EntityInstance.lastActivityAt`
 * when written. These represent system-managed bookkeeping (background
 * enrichment, AI override) — not real activity.
 *
 * - `nextActionOverride` (Phase 4) — setting the override IS the next action;
 *   re-firing on its own write would be a feedback loop.
 * - `company_enriched_at`, `company_enrichment_status` — written by the
 *   background company-enrichment trigger, not by users or AI.
 *
 * Custom-field signal: any field with `hidden: true, creatable: false,
 * updatable: true` is also system-managed by convention. We don't dynamically
 * walk the registry yet — keeps startup cheap and the skip-set explicit. If
 * more system fields land we'll add them here.
 */
const SKIPPED_SYSTEM_ATTRIBUTES = new Set<string>([
  'nextActionOverride',
  'company_enriched_at',
  'company_enrichment_status',
])

/**
 * Global field-change post-hook. Advances `lastActivityAt` on the entity
 * being written, monotonically. Failures are logged inside the helper and
 * never break the write.
 *
 * AI-driven writes (e.g. kopilot's `bulk_update_entity`) flow through the
 * same field-mutation path as user edits, so they DO touch activity. That's
 * intentional — AI writes are real activity.
 */
export const touchActivityOnFieldChange: EntityFieldChangeHandler = async (event) => {
  const systemAttribute = (event.field as { systemAttribute?: string }).systemAttribute
  if (systemAttribute && SKIPPED_SYSTEM_ATTRIBUTES.has(systemAttribute)) return

  const instanceId = getInstanceId(event.recordId)
  if (!instanceId) return

  await touchEntityActivity([instanceId], event.organizationId)
}
