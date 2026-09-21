// packages/lib/scripts/backfill-fulfillment-totals.ts
//
// One-time backfill: stamp `fulfillment_subtotal` / `_total` /
// `_shipping_recognised` on every synced fulfillment (78 §4.4). The synced
// lane writes only `fulfillment_line_quantity`; those three fields have no
// writer for a Shopify-created shipment, so every one reads as zero and the
// recognition timeline refuses the order (78 §1.2). `stampOrderShipmentTotals`
// is that writer; this is the one-time pass over orders it never ran on.
//
// Idempotent: it recomputes from the order's own lines and compares before
// writing (78 §4.1), so a second run writes nothing.
//
// Run from the repo root:
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-fulfillment-totals.ts [--org <organizationId>]

import { database } from '@auxx/database'
import { sql } from 'drizzle-orm'
// Relative import on purpose — see the note in backfill-po-line-rollups.ts.
import { stampOrderShipmentTotals } from '../src/accounting/sales/fulfillments/stamp-totals'

const ORG_ARG = (() => {
  const flagIndex = process.argv.indexOf('--org')
  return flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
})()

/** Every (org, order) with at least one fulfillment carrying no `fulfillment_subtotal` row. */
async function candidateOrders(): Promise<{ org: string; order: string }[]> {
  const rows = await database.execute<{ organizationId: string; orderInstanceId: string }>(sql`
    SELECT fo."organizationId", fo."relatedEntityId" AS "orderInstanceId"
    FROM "FieldValue" fo
    JOIN "CustomField" cf ON cf.id = fo."fieldId"
    WHERE cf."systemAttribute" = 'fulfillment_order'
      AND fo."relatedEntityId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "FieldValue" sub
        JOIN "CustomField" cfSub ON cfSub.id = sub."fieldId"
        WHERE cfSub."systemAttribute" = 'fulfillment_subtotal'
          AND sub."entityId" = fo."entityId"
          AND sub."organizationId" = fo."organizationId"
      )
      ${ORG_ARG ? sql`AND fo."organizationId" = ${ORG_ARG}` : sql``}
    GROUP BY fo."organizationId", fo."relatedEntityId"
  `)
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])
  return (list as { organizationId: string; orderInstanceId: string }[]).map((r) => ({
    org: r.organizationId,
    order: r.orderInstanceId,
  }))
}

async function main(): Promise<void> {
  const orders = await candidateOrders()
  console.log(
    ORG_ARG
      ? `${orders.length} order(s) with an unstamped fulfillment (org ${ORG_ARG})`
      : `${orders.length} order(s) with an unstamped fulfillment`
  )

  let ordersTouched = 0
  let fulfillmentsWritten = 0
  let skippedPosted = 0
  let ordersErrored = 0

  for (const { org, order } of orders) {
    try {
      const result = await stampOrderShipmentTotals(database, org, order)
      if (result.fulfillmentsWritten > 0) ordersTouched++
      fulfillmentsWritten += result.fulfillmentsWritten
      skippedPosted += result.skippedPosted
    } catch (error) {
      ordersErrored++
      console.error(
        `  FAILED order ${order} (org ${org}):`,
        error instanceof Error ? error.message : error
      )
    }
  }

  console.log(
    `orders touched: ${ordersTouched}, fulfillments written: ${fulfillmentsWritten}, ` +
      `posted-and-skipped: ${skippedPosted}, orders errored: ${ordersErrored}`
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
