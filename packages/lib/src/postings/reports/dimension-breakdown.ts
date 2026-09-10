// packages/lib/src/postings/reports/dimension-breakdown.ts
//
// One dimension value's totals on one account, over a window - the read that
// makes brief 13 §5's acceptance true: the P&L can still split revenue by
// channel, now by grouping on `GlPostingLine.dimensions` rather than by
// reading a second account.
//
// No screen reads this in this pass (brief 13 §5.5 says so explicitly) - this
// is the read half only, so the next screen does not have to invent the query.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'

const logger = createScopedLogger('postings:reports:dimension-breakdown')

/**
 * Both statuses, like every other statement read in this folder
 * (`account-lines.ts`, `trial-balance.ts`): a reversed entry's PAIR of lines
 * both count, so the two net to zero rather than one side vanishing from the
 * breakdown.
 */
const POSTED_STATUSES = ['posted', 'reversed'] as const

/** One dimension value's totals on one account. Raw, not natural-signed. */
export interface DimensionBreakdownRow {
  /**
   * The dimension's value on the line - `'dtc'`, `'CO'`. `null` groups every
   * line on the account with NO such dimension at all (the column is null, or
   * it holds an object with no such key) - which is most lines on most
   * accounts, and a real row rather than an omission.
   */
  value: string | null
  debitMinor: number
  creditMinor: number
  /** `debitMinor - creditMinor`. Raw: the caller applies its own account's natural sign. */
  balanceMinor: number
}

export interface ReadDimensionBreakdownOptions {
  organizationId: string
  /** The `gl_account` EntityInstance id - task 15's identity, not a code. */
  glAccountId: string
  /** The `dimensions` key to group by - `'channel'`, `'jurisdiction'`. */
  dimension: string
  /** `YYYY-MM-DD`. Omit for a cumulative-from-the-beginning read. */
  from?: string
  /** `YYYY-MM-DD`, inclusive. Omit for open-ended. */
  to?: string
}

/**
 * Sum debits and credits on one account, grouped by one `dimensions` key.
 *
 * `dimensions ->> dimension` is a Postgres jsonb text-extraction: it reads
 * `null` for a line whose `dimensions` column is null OR simply does not carry
 * that key, so the null bucket below needs no `coalesce` of its own to mean
 * "no dimension" rather than "dimension explicitly blank".
 *
 * Sorted with the null bucket last and every named value alphabetically
 * before it, so a screen rendering this list in order never has to sort it
 * again or explain why "no channel" appears in the middle.
 */
export async function readDimensionBreakdown(
  db: Database,
  options: ReadDimensionBreakdownOptions
): Promise<Result<DimensionBreakdownRow[], Error>> {
  const { organizationId, glAccountId, dimension, from, to } = options

  try {
    const value = sql<string | null>`${schema.GlPostingLine.dimensions} ->> ${dimension}`

    const bounds = [
      eq(schema.GlPosting.organizationId, organizationId),
      inArray(schema.GlPosting.status, [...POSTED_STATUSES]),
      eq(schema.GlPostingLine.glAccountId, glAccountId),
    ]
    if (from) bounds.push(gte(schema.GlPosting.txnDate, from))
    if (to) bounds.push(lte(schema.GlPosting.txnDate, to))

    const rows = await db
      .select({
        value,
        debitMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'debit'), 0)`,
        creditMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'credit'), 0)`,
      })
      .from(schema.GlPostingLine)
      .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
      .where(and(...bounds))
      .groupBy(value)

    const breakdown = rows.map((row) => {
      const debitMinor = toMinor(row.debitMinor)
      const creditMinor = toMinor(row.creditMinor)
      return {
        value: row.value ?? null,
        debitMinor,
        creditMinor,
        balanceMinor: debitMinor - creditMinor,
      }
    })
    breakdown.sort((a, b) => {
      if (a.value === b.value) return 0
      if (a.value === null) return 1
      if (b.value === null) return -1
      return a.value < b.value ? -1 : 1
    })

    return ok(breakdown)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read a dimension breakdown', {
      error,
      organizationId,
      glAccountId,
      dimension,
      from,
      to,
    })
    return err(new AuxxError('Internal error'))
  }
}

/** A number the driver may have handed back as text. */
function toMinor(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}
