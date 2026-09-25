// packages/lib/src/accounting/ledger/reads/opening-inventory.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, or, sql } from 'drizzle-orm'

/** The line `sourceType` every opening inventory difference entry stamps, so it reads as baseline. */
export const OPENING_INVENTORY_ADJUSTMENT_SOURCE = 'opening_inventory_adjustment' as const

/** What the ledger holds on the given accounts from the opening, net debit-positive per account. */
export interface OpeningInventoryLedger {
  /** The `opening_balance` entry's lines. */
  openingByAccount: Map<string, number>
  /** Every opening inventory difference entry's lines, all occurrences summed (111 Q23). */
  adjustmentByAccount: Map<string, number>
  /** How many difference entries stand posted, for the next one's number. */
  differenceEntries: number
}

/**
 * The opening entry and every opening inventory difference entry on these accounts. Every
 * status is summed, so a reversed entry and its reversal net to zero and a re-post counts once.
 */
export async function readOpeningInventoryLedger(
  db: Database,
  organizationId: string,
  glAccountIds: readonly string[]
): Promise<OpeningInventoryLedger> {
  const result: OpeningInventoryLedger = {
    openingByAccount: new Map(),
    adjustmentByAccount: new Map(),
    differenceEntries: 0,
  }

  const [counted] = await db
    .select({
      entries: sql<string>`count(distinct ${schema.GlPostingLine.glPostingId})`,
    })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        eq(schema.GlPostingLine.sourceType, OPENING_INVENTORY_ADJUSTMENT_SOURCE),
        eq(schema.GlPosting.status, 'posted')
      )
    )
  result.differenceEntries = Number(counted?.entries ?? 0)
  if (glAccountIds.length === 0) return result

  const rows = await db
    .select({
      glAccountId: schema.GlPostingLine.glAccountId,
      sourceType: schema.GlPostingLine.sourceType,
      netMinor: sql<string>`coalesce(sum(case when ${schema.GlPostingLine.direction} = 'debit' then ${schema.GlPostingLine.amountMinor} else -${schema.GlPostingLine.amountMinor} end), 0)`,
    })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        inArray(schema.GlPostingLine.glAccountId, [...glAccountIds]),
        or(
          eq(schema.GlPosting.postingType, 'opening_balance'),
          eq(schema.GlPostingLine.sourceType, OPENING_INVENTORY_ADJUSTMENT_SOURCE)
        )
      )
    )
    .groupBy(schema.GlPostingLine.glAccountId, schema.GlPostingLine.sourceType)

  for (const row of rows) {
    const isAdjustment = row.sourceType === OPENING_INVENTORY_ADJUSTMENT_SOURCE
    const target = isAdjustment ? result.adjustmentByAccount : result.openingByAccount
    target.set(row.glAccountId, (target.get(row.glAccountId) ?? 0) + Number(row.netMinor))
  }
  return result
}
