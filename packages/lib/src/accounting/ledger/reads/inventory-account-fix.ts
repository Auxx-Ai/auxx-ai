// packages/lib/src/accounting/ledger/reads/inventory-account-fix.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'

/** The line `sourceType` every inventory account fix entry stamps; `sourceId` is the part. */
export const INVENTORY_ACCOUNT_FIX_SOURCE = 'inventory_account_fix' as const

/** Per part: signed (debit-positive) minor units moved per inventory role, and entries ever written. */
export interface InventoryAccountFixTotals {
  byRole: Map<string, number>
  /** Every status, so a reversed entry's number is never reused. */
  entries: number
}

/**
 * What the account-fix entries have already moved between inventory roles, per part. Every status
 * is summed, so a reversed fix and its reversal net to zero. Omit `partIds` for the whole org.
 */
export async function readInventoryAccountFixTotals(
  db: Database | Transaction,
  organizationId: string,
  partIds?: readonly string[]
): Promise<Map<string, InventoryAccountFixTotals>> {
  const result = new Map<string, InventoryAccountFixTotals>()
  if (partIds && partIds.length === 0) return result

  const rows = await db
    .select({
      partId: schema.GlPostingLine.sourceId,
      role: schema.GlPostingLine.accountRole,
      netMinor: sql<string>`coalesce(sum(case when ${schema.GlPostingLine.direction} = 'debit' then ${schema.GlPostingLine.amountMinor} else -${schema.GlPostingLine.amountMinor} end), 0)`,
    })
    .from(schema.GlPostingLine)
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        eq(schema.GlPostingLine.sourceType, INVENTORY_ACCOUNT_FIX_SOURCE),
        ...(partIds ? [inArray(schema.GlPostingLine.sourceId, [...new Set(partIds)])] : [])
      )
    )
    .groupBy(schema.GlPostingLine.sourceId, schema.GlPostingLine.accountRole)

  const entryRows = await db
    .select({
      partId: schema.GlPostingLine.sourceId,
      entries: sql<string>`count(distinct ${schema.GlPostingLine.glPostingId})`,
    })
    .from(schema.GlPostingLine)
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        eq(schema.GlPostingLine.sourceType, INVENTORY_ACCOUNT_FIX_SOURCE),
        ...(partIds ? [inArray(schema.GlPostingLine.sourceId, [...new Set(partIds)])] : [])
      )
    )
    .groupBy(schema.GlPostingLine.sourceId)

  for (const row of entryRows) {
    if (!row.partId) continue
    result.set(row.partId, { byRole: new Map(), entries: Number(row.entries) })
  }
  for (const row of rows) {
    if (!row.partId || !row.role) continue
    const totals = result.get(row.partId) ?? { byRole: new Map(), entries: 0 }
    totals.byRole.set(row.role, (totals.byRole.get(row.role) ?? 0) + Number(row.netMinor))
    result.set(row.partId, totals)
  }
  return result
}
