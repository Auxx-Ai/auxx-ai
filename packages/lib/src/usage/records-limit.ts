// packages/lib/src/usage/records-limit.ts

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { UsageLimitError } from '../errors'
import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { FeatureKey, type FeatureLimit } from '../permissions/types'
import { readMeteredRecordCount } from './records-count'
import { isMeteredDef } from './records-metered'

/** The records limit as the UI shows it. `soft`/`hard` are null when unlimited. */
export interface RecordsUsage {
  count: number
  soft: number | null
  hard: number | null
  softReached: boolean
  hardReached: boolean
}

/** '+', -1, or a key the org's plan has not been seeded with yet all read as unlimited. */
function toRecordLimit(limit: FeatureLimit | null): number | null {
  if (typeof limit !== 'number' || limit < 0) return null
  return limit
}

/** The org's `recordsSoft` / `recordsHard`, null meaning unlimited. */
export async function readRecordsLimits(
  organizationId: string
): Promise<{ soft: number | null; hard: number | null }> {
  const features = new FeaturePermissionService()
  const [hard, soft] = await Promise.all([
    features.getLimit(organizationId, FeatureKey.recordsHard),
    features.getLimit(organizationId, FeatureKey.recordsSoft),
  ])
  return { soft: toRecordLimit(soft), hard: toRecordLimit(hard) }
}

/** Pure: fold a count and limits into the usage shape. */
export function toRecordsUsage(
  count: number,
  limits: { soft: number | null; hard: number | null }
): RecordsUsage {
  return {
    count,
    soft: limits.soft,
    hard: limits.hard,
    softReached: limits.soft !== null && count >= limits.soft,
    hardReached: limits.hard !== null && count >= limits.hard,
  }
}

/** Count and limits for the billing page and the soft/hard banners. The count may lag by the cache TTL. */
export async function readRecordsUsage(
  db: Database,
  organizationId: string
): Promise<Result<RecordsUsage, Error>> {
  try {
    const [limits, count] = await Promise.all([
      readRecordsLimits(organizationId),
      readMeteredRecordCount(db, organizationId),
    ])
    return ok(toRecordsUsage(count, limits))
  } catch (error) {
    return err(error as Error)
  }
}

/** Remaining room under `recordsHard` (0 when at or over), or null when unlimited. */
export async function readRecordsHeadroom(
  db: Database,
  organizationId: string
): Promise<Result<number | null, Error>> {
  const usage = await readRecordsUsage(db, organizationId)
  if (usage.isErr()) return err(usage.error)
  const { hard, count } = usage.value
  return ok(hard === null ? null : Math.max(0, hard - count))
}

/**
 * Refuse a user-initiated create of `quantity` counted records that would pass
 * `recordsHard`. With `entityDefinitionId` an unmetered def always passes; without
 * it the check is org-level (connector sync starts). A refusal recounts once, so
 * deletes since the last cache fill free room immediately.
 *
 * Returns whether the def is metered, so the caller can `noteMeteredRecordsCreated`.
 */
export async function assertRecordRoom(
  db: Database,
  organizationId: string,
  input: { entityDefinitionId?: string; quantity?: number }
): Promise<{ metered: boolean }> {
  const quantity = input.quantity ?? 1
  if (input.entityDefinitionId) {
    const metered = await isMeteredDef(db, organizationId, input.entityDefinitionId)
    if (!metered) return { metered: false }
  }

  const { hard } = await readRecordsLimits(organizationId)
  if (hard === null) return { metered: true }

  const cached = await readMeteredRecordCount(db, organizationId)
  if (cached + quantity <= hard) return { metered: true }

  const current = await readMeteredRecordCount(db, organizationId, { fresh: true })
  if (current + quantity <= hard) return { metered: true }

  throw new UsageLimitError({
    metric: 'records',
    current,
    limit: hard,
    message:
      quantity > 1 && current < hard
        ? `This would create ${quantity} records, but your plan has room for ${hard - current} more (${current}/${hard}). Upgrade your plan to continue.`
        : `You have reached your plan's records limit (${current}/${hard}). Upgrade your plan to add more records.`,
  })
}
