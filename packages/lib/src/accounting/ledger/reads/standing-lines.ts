// packages/lib/src/accounting/ledger/reads/standing-lines.ts

/**
 * The one `where` every aggregate over `GlPostingLine` joined to `GlPosting`
 * shares: this org, a status whose lines are standing in the books, and the
 * optional date window and account narrowing.
 *
 * The select lists, the joins and the group-bys stay in the reports - only the
 * predicate is shared, because that is the part six copies had drifted on
 * (`POSTED_STATUSES` declared six times, one copy scoping the ORG off the LINE).
 */

import { schema } from '@auxx/database'
import { and, eq, gte, inArray, lte, type SQL } from 'drizzle-orm'
import { POSTED_STATUSES } from '../types'

export interface StandingLineFilter {
  /** Inclusive lower bound on `GlPosting.txnDate`, `YYYY-MM-DD`. */
  from?: string
  /** Inclusive upper bound on `GlPosting.txnDate`, `YYYY-MM-DD`. */
  to?: string
  /** Narrow to these `GlPostingLine.glAccountId`s. Omit for the whole chart. */
  glAccountIds?: readonly string[]
}

/** The shared `and(...)` for a standing-lines aggregate. Never narrows by itself. */
export function standingLineFilter(organizationId: string, filter: StandingLineFilter): SQL {
  const { from, to, glAccountIds } = filter
  // Non-null: the first two arguments are always present.
  return and(
    eq(schema.GlPosting.organizationId, organizationId),
    inArray(schema.GlPosting.status, [...POSTED_STATUSES]),
    ...(from ? [gte(schema.GlPosting.txnDate, from)] : []),
    ...(to ? [lte(schema.GlPosting.txnDate, to)] : []),
    ...(glAccountIds
      ? [
          glAccountIds.length === 1
            ? eq(schema.GlPostingLine.glAccountId, glAccountIds[0] as string)
            : inArray(schema.GlPostingLine.glAccountId, [...glAccountIds]),
        ]
      : [])
  ) as SQL
}
