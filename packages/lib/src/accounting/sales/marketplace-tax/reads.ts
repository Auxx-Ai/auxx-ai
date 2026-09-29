// packages/lib/src/accounting/sales/marketplace-tax/reads.ts

import type { Database } from '@auxx/database'
import { sql } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../../cache'
import { ACCOUNT_ROLES } from '../../ledger/builders/entry'

/** One order's channel-remitted tax: what the books hold for it against what the channel withheld. */
export interface MarketplaceTaxBalance {
  orderId: string
  orderNumber: string | null
  currency: string
  /** Net 2210 credits from the order's live shipment entries. */
  bookedMinor: number
  /** Net 2210 debits from the live entries of the order's credit memos. */
  returnedMinor: number
  /** Net tax the channel withheld from payouts for the order; negative once it gives back more. */
  withheldMinor: number
  /** The latest shipment, memo or withholding date - the grace window runs from here. */
  lastActivityOn: string
}

/**
 * Every order with 2210 activity or a `tax_withheld` payout line. A reversed entry and its
 * reversal are both left out, so they net; payout lines reach their order by `RecordIdentity`.
 */
export async function readMarketplaceTaxBalances(
  db: Database,
  organizationId: string
): Promise<MarketplaceTaxBalance[]> {
  const orderDefId = await getCachedEntityDefId(organizationId, 'order')
  if (!orderDefId) return []
  const result = await db.execute(sql`
    WITH live AS (
      SELECT p.id, p."txnDate", p.currency,
        sum(CASE WHEN l.direction = 'credit' THEN l."amountMinor" ELSE -l."amountMinor" END) AS credit
      FROM "GlPostingLine" l
      JOIN "GlPosting" p ON p.id = l."glPostingId"
      WHERE l."organizationId" = ${organizationId}
        AND l."accountRole" = ${ACCOUNT_ROLES.MARKETPLACE_TAX_COLLECTED}
        AND p.status = 'posted' AND p."reversesId" IS NULL
      GROUP BY p.id
    ),
    booked AS (
      SELECT s."sourceId" AS "orderId", sum(live.credit) AS amount, max(live."txnDate") AS "lastOn",
        max(live.currency) AS currency
      FROM live
      JOIN "GlPostingSource" s ON s."glPostingId" = live.id
        AND s."sourceKind" = 'order' AND s."linkRole" = 'parent'
      GROUP BY 1
    ),
    returned AS (
      SELECT mo."relatedEntityId" AS "orderId", -sum(live.credit) AS amount,
        max(live."txnDate") AS "lastOn", max(live.currency) AS currency
      FROM live
      JOIN "GlPostingSource" s ON s."glPostingId" = live.id
        AND s."sourceKind" = 'credit_memo' AND s."linkRole" = 'subject'
      JOIN "CustomField" f ON f."organizationId" = ${organizationId}
        AND f."systemAttribute" = 'credit_memo_order'
      JOIN "FieldValue" mo ON mo."entityId" = s."sourceId" AND mo."fieldId" = f.id
      WHERE mo."relatedEntityId" IS NOT NULL
      GROUP BY 1
    ),
    withheld AS (
      SELECT ri."entityInstanceId" AS "orderId", -sum(e."netMinor") AS amount,
        max(e."transactionDate")::date AS "lastOn", max(e.currency) AS currency
      FROM "ProcessorBalanceEntry" e
      JOIN "RecordIdentity" ri ON ri."organizationId" = e."organizationId"
        AND ri."entityDefinitionId" = ${orderDefId} AND ri."externalId" = e."sourceOrderId"
      WHERE e."organizationId" = ${organizationId} AND e.type = 'tax_withheld'
      GROUP BY 1
    ),
    orders AS (
      SELECT "orderId" FROM booked UNION SELECT "orderId" FROM returned
      UNION SELECT "orderId" FROM withheld
    )
    SELECT o."orderId", e."displayName" AS "orderNumber",
      coalesce(b.currency, r.currency, w.currency) AS currency,
      coalesce(b.amount, 0)::bigint AS "bookedMinor",
      coalesce(r.amount, 0)::bigint AS "returnedMinor",
      coalesce(w.amount, 0)::bigint AS "withheldMinor",
      greatest(b."lastOn", r."lastOn", w."lastOn")::text AS "lastActivityOn"
    FROM orders o
    LEFT JOIN booked b ON b."orderId" = o."orderId"
    LEFT JOIN returned r ON r."orderId" = o."orderId"
    LEFT JOIN withheld w ON w."orderId" = o."orderId"
    LEFT JOIN "EntityInstance" e ON e."organizationId" = ${organizationId} AND e.id = o."orderId"
  `)
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    orderId: String(row.orderId),
    orderNumber: row.orderNumber == null ? null : String(row.orderNumber),
    currency: String(row.currency),
    bookedMinor: Number(row.bookedMinor),
    returnedMinor: Number(row.returnedMinor),
    withheldMinor: Number(row.withheldMinor),
    lastActivityOn: String(row.lastActivityOn),
  }))
}
