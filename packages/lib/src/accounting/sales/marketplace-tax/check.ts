// packages/lib/src/accounting/sales/marketplace-tax/check.ts

import { type Database, schema } from '@auxx/database'
import { formatCurrency } from '@auxx/utils/currency'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type { WorkItemRefusal } from '../../work-items/refusal'
import { upsertWorkItems, type WorkItemKey } from '../../work-items/write'
import { classifyMarketplaceTax, MARKETPLACE_TAX_CODES, type MarketplaceTaxCode } from './classify'
import { readMarketplaceTaxBalances } from './reads'

/**
 * Flag every order whose channel-remitted tax and the channel's withholding do not meet, and
 * clear the flags of those that now do (116 §6). Never writes to the ledger.
 */
export async function checkMarketplaceTax(
  db: Database,
  input: { organizationId: string; today?: string }
): Promise<Result<{ flagged: number; cleared: number }, Error>> {
  const { organizationId } = input
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  try {
    const balances = await readMarketplaceTaxBalances(db, organizationId)
    const byCode = new Map<MarketplaceTaxCode, Array<WorkItemKey & WorkItemRefusal>>()
    for (const balance of balances) {
      const code = classifyMarketplaceTax(balance, today)
      if (!code) continue
      const money = (minor: number) => formatCurrency(minor, { currencyCode: balance.currency })
      const held = balance.bookedMinor - balance.returnedMinor
      const items = byCode.get(code) ?? []
      items.push({
        sourceKind: 'order',
        sourceId: balance.orderId,
        stage: 'post',
        reasonCode: code,
        externalRef: balance.orderNumber,
        detail: {
          orderNumber: balance.orderNumber,
          currency: balance.currency,
          held: money(held),
          withheld: money(balance.withheldMinor),
          difference: money(Math.abs(balance.withheldMinor - held)),
        },
      })
      byCode.set(code, items)
    }
    for (const items of byCode.values()) {
      const written = await upsertWorkItems(db, organizationId, items)
      if (written.isErr()) return err(written.error)
    }

    const flaggedIds = [...byCode.values()].flat().map((item) => item.sourceId)
    const t = schema.AccountingWorkItem
    const cleared = await db
      .delete(t)
      .where(
        and(
          eq(t.organizationId, organizationId),
          eq(t.sourceKind, 'order'),
          inArray(t.reasonCode, [...MARKETPLACE_TAX_CODES]),
          flaggedIds.length ? notInArray(t.sourceId, flaggedIds) : undefined
        )
      )
      .returning({ id: t.id })
    return ok({ flagged: flaggedIds.length, cleared: cleared.length })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
