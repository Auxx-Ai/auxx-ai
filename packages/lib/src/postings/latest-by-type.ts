// packages/lib/src/postings/latest-by-type.ts

/**
 * The most recent `GlPosting` of each posting type an organization has, in
 * one grouped read (plans/accounting/tasks/28-how-your-books-post.md §3.2).
 *
 * The Posting settings page shows "Last posted 2026-09-13 (AUXX-FUL-20260913)"
 * under every section, and there are fourteen sections. `listPostings` answers
 * one month at a time and excludes the close entry, so it cannot give every
 * section its line; a `DISTINCT ON (postingType)` over the org's postings can,
 * in one round trip.
 *
 * "Latest" is by accounting date first and creation time second, the same
 * order `listPostings` lists in: the entry a bookkeeper calls the last one is
 * the one dated last, and two entries dated the same day tie-break on which
 * was written later. `status` rides along unfiltered, because a reversal is
 * itself a posting of the same type and dated later, so the newest row of a
 * type may legitimately be one that reversed another.
 *
 * No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { asc, desc, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'
import type { PostingStatus, PostingType } from './types'

const logger = createScopedLogger('postings:latest-by-type')

/** The newest posting of one type, as the Posting page prints it. */
export interface LatestPostingByType {
  postingType: PostingType
  /** `YYYY-MM-DD`, the accounting date. */
  txnDate: string
  docNumber: string
  status: PostingStatus
}

/**
 * One row per posting type the organization has ever posted, newest first
 * within each type collapsed to its single newest row. A type with no posting
 * is simply absent, which is the page's "never posted" state.
 */
export async function readLatestPostingsByType(
  db: Database,
  options: { organizationId: string }
): Promise<Result<LatestPostingByType[], Error>> {
  const { organizationId } = options

  try {
    // `DISTINCT ON` keeps the first row per type under this ORDER BY, and
    // Postgres requires the distinct column to lead the ordering.
    const rows = await db
      .selectDistinctOn([schema.GlPosting.postingType], {
        postingType: schema.GlPosting.postingType,
        txnDate: schema.GlPosting.txnDate,
        docNumber: schema.GlPosting.docNumber,
        status: schema.GlPosting.status,
      })
      .from(schema.GlPosting)
      .where(eq(schema.GlPosting.organizationId, organizationId))
      .orderBy(
        asc(schema.GlPosting.postingType),
        desc(schema.GlPosting.txnDate),
        desc(schema.GlPosting.createdAt)
      )

    return ok(rows.map(toLatest))
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read latest postings by type', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

type LatestRow = {
  postingType: string
  txnDate: Date | string
  docNumber: string
  status: string
}

function toLatest(row: LatestRow): LatestPostingByType {
  return {
    postingType: row.postingType as PostingType,
    txnDate: toDateKey(row.txnDate),
    docNumber: row.docNumber,
    status: row.status as PostingStatus,
  }
}

/**
 * Keep a Postgres `date` as `YYYY-MM-DD`. Drizzle's `date()` is string-mode, so
 * this is a pass-through in production; the `Date` branch keeps the accounting
 * date from acquiring a time and a zone on its way to a browser.
 */
function toDateKey(value: Date | string): string {
  if (typeof value === 'string') return value
  return value.toISOString().slice(0, 10)
}
