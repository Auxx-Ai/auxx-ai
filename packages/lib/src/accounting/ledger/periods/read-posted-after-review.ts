// packages/lib/src/accounting/ledger/periods/read-posted-after-review.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toIso } from '@auxx/utils/calendar-day'
import { and, asc, eq, gt, gte, lt, lte, or } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../../errors'
import { readOrganizationSettings } from '../../../settings/read'
import type { PostingSummary } from '../../journals/entries/client'
import { POSTING_COLUMNS, toSummary } from '../reads/list-postings'
import { OPENING_BASELINE_SETTING_KEYS } from '../setup/setup-readiness'
import { PERIOD_LOCK_SETTING_KEY } from './period-lock'
import { compareMonths, monthBounds } from './periods'

const logger = createScopedLogger('ledger:posted-after-review')

const DEFAULT_LIMIT = 500
const MONTH_KEY = /^\d{4}-\d{2}$/

/** A posting dated in a reviewed month and created after that month was reviewed. */
export interface PostedAfterReviewEntry extends PostingSummary {
  createdAt: string
}

/** One reviewed month's late entries. Months with none are not returned. */
export interface PostedAfterReviewMonth {
  periodKey: string
  /** When the Reviewed-through marker last moved onto or past this month. */
  reviewedAt: string
  /** True when no audit row covers the month and the setting's `updatedAt` stood in. */
  reviewedAtApproximate: boolean
  entries: PostedAfterReviewEntry[]
}

export interface ReadPostedAfterReviewOptions {
  organizationId: string
  /** Inclusive `YYYY-MM-DD` bounds on `txnDate`; omit for every reviewed month. */
  from?: string
  to?: string
  limit?: number
}

/**
 * Entries whose `txnDate` falls in a month at or before `ledger.lockedThroughMonth` and whose
 * `createdAt` is after the marker last moved onto that month, oldest month first.
 */
export async function readPostedAfterReview(
  db: Database,
  options: ReadPostedAfterReviewOptions
): Promise<Result<PostedAfterReviewMonth[], Error>> {
  const { organizationId, from, to, limit = DEFAULT_LIMIT } = options
  try {
    const settings = await readOrganizationSettings(organizationId, [
      OPENING_BASELINE_SETTING_KEYS.cutoffPeriod,
    ] as const)
    const cutoff = settings[OPENING_BASELINE_SETTING_KEYS.cutoffPeriod]?.trim() || null

    // Read uncached: the fallback needs the row's `updatedAt`, which the settings cache drops.
    const [lockRow] = await db
      .select({
        value: schema.OrganizationSetting.value,
        updatedAt: schema.OrganizationSetting.updatedAt,
      })
      .from(schema.OrganizationSetting)
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, organizationId),
          eq(schema.OrganizationSetting.key, PERIOD_LOCK_SETTING_KEY)
        )
      )
      .limit(1)
    const reviewedThrough = typeof lockRow?.value === 'string' ? lockRow.value.trim() : ''
    if (!cutoff || !MONTH_KEY.test(cutoff) || !MONTH_KEY.test(reviewedThrough)) return ok([])

    const months = reviewedMonths({
      cutoff,
      reviewedThrough,
      fromMonth: from?.slice(0, 7),
      toMonth: to?.slice(0, 7),
    })
    if (months.length === 0) return ok([])

    const moves = await db
      .select({
        previousState: schema.AuditLog.previousState,
        newState: schema.AuditLog.newState,
        createdAt: schema.AuditLog.createdAt,
      })
      .from(schema.AuditLog)
      .where(
        and(
          eq(schema.AuditLog.organizationId, organizationId),
          eq(schema.AuditLog.targetType, 'OrganizationSetting'),
          eq(schema.AuditLog.targetId, PERIOD_LOCK_SETTING_KEY)
        )
      )
      .orderBy(asc(schema.AuditLog.createdAt))

    const fallback = lockRow?.updatedAt ?? new Date(0)
    const reviewed = months.map((periodKey) => {
      const at = lastMoveOnto(periodKey, moves)
      return {
        periodKey,
        reviewedAt: at ?? fallback,
        reviewedAtApproximate: at === null,
        ...monthBounds(periodKey),
      }
    })

    const rows = await db
      .select({ ...POSTING_COLUMNS, createdAt: schema.GlPosting.createdAt })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          from ? gte(schema.GlPosting.txnDate, from) : undefined,
          to ? lte(schema.GlPosting.txnDate, to) : undefined,
          or(
            ...reviewed.map((month) =>
              and(
                gte(schema.GlPosting.txnDate, month.first),
                lt(schema.GlPosting.txnDate, month.next),
                gt(schema.GlPosting.createdAt, month.reviewedAt)
              )
            )
          )
        )
      )
      .orderBy(
        asc(schema.GlPosting.txnDate),
        asc(schema.GlPosting.createdAt),
        asc(schema.GlPosting.id)
      )
      .limit(limit)

    const byMonth = new Map<string, PostedAfterReviewEntry[]>()
    for (const { createdAt, ...row } of rows) {
      const summary = toSummary(row)
      const periodKey = summary.txnDate.slice(0, 7)
      const list = byMonth.get(periodKey) ?? []
      list.push({ ...summary, createdAt: toIso(createdAt) ?? '' })
      byMonth.set(periodKey, list)
    }

    return ok(
      reviewed
        .filter((month) => byMonth.has(month.periodKey))
        .map((month) => ({
          periodKey: month.periodKey,
          reviewedAt: month.reviewedAt.toISOString(),
          reviewedAtApproximate: month.reviewedAtApproximate,
          entries: byMonth.get(month.periodKey) ?? [],
        }))
    )
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read postings made after review', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/** Months after the cutoff through the marker, narrowed to `[fromMonth, toMonth]`. */
function reviewedMonths(input: {
  cutoff: string
  reviewedThrough: string
  fromMonth?: string
  toMonth?: string
}): string[] {
  const last =
    input.toMonth && compareMonths(input.toMonth, input.reviewedThrough) < 0
      ? input.toMonth
      : input.reviewedThrough
  const months: string[] = []
  let month = monthBounds(input.cutoff).next.slice(0, 7)
  while (compareMonths(month, last) <= 0) {
    if (!input.fromMonth || compareMonths(month, input.fromMonth) >= 0) months.push(month)
    month = monthBounds(month).next.slice(0, 7)
  }
  return months
}

/** The latest audited write that took the marker from before `month` to at or after it. */
function lastMoveOnto(
  month: string,
  moves: { previousState: unknown; newState: unknown; createdAt: Date }[]
): Date | null {
  let latest: Date | null = null
  for (const move of moves) {
    const before = auditedMonth(move.previousState)
    const after = auditedMonth(move.newState)
    if (!after || compareMonths(after, month) < 0) continue
    if (before && compareMonths(before, month) >= 0) continue
    latest = move.createdAt
  }
  return latest
}

/** `{ value: 'YYYY-MM' }` as `setLockedThrough` records it, else null. */
function auditedMonth(state: unknown): string | null {
  const value = (state as { value?: unknown } | null)?.value
  return typeof value === 'string' && MONTH_KEY.test(value.trim()) ? value.trim() : null
}
