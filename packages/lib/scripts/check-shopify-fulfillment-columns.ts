// packages/lib/scripts/check-shopify-fulfillment-columns.ts
// Dev check: did the phase-0a columns actually receive values after the remap+backfill?

import { database as db } from '@auxx/database'
import { sql } from 'drizzle-orm'

const CONNECTOR_ID = process.env.CONNECTOR_ID ?? 't0e33r78tehnzcrbkqur0tcc'

async function main() {
  const runs = await db.execute(sql`
    SELECT status, fetched, created, updated, skipped, failed, "startedAt"
    FROM "DataConnectorRun" WHERE "dataConnectorId" = ${CONNECTOR_ID}
    ORDER BY "startedAt" DESC NULLS LAST LIMIT 4
  `)
  console.log('\n=== recent runs ===')
  for (const r of runs.rows as any[]) {
    console.log(
      `  ${r.startedAt?.toISOString?.() ?? r.startedAt}  ${r.status}  fetched=${r.fetched} updated=${r.updated} skipped=${r.skipped} failed=${r.failed}`
    )
  }

  const counts = await db.execute(sql`
    SELECT ed."apiSlug" AS def, cf."appFieldKey", cf.type, count(fv.id) AS n
    FROM "CustomField" cf
    JOIN "EntityDefinition" ed ON ed.id = cf."entityDefinitionId"
    LEFT JOIN "FieldValue" fv ON fv."fieldId" = cf.id
    WHERE ed."apiSlug" IN ('shopify_orders','shopify_line_items')
      AND cf."appFieldKey" IN (
        'paymentGateways','firstFulfilledAt','lastFulfilledAt','shipmentCount','isSplitShipment',
        'lineItems.fulfillableQuantity','lineItems.fulfilledAt','lineItems.lastFulfilledAt',
        'lineItems.fulfilledQuantity','lineItems.shipmentCount','lineItems.trackingNumber')
    GROUP BY 1,2,3 ORDER BY 1,2
  `)
  console.log('\n=== phase-0a column value counts ===')
  for (const r of counts.rows as any[]) {
    console.log(`  ${Number(r.n) > 0 ? '✅' : '  '} ${r.def}.${r.appFieldKey} (${r.type}): ${r.n}`)
  }

  // The split-shipment order: the whole point of the feature.
  const split = await db.execute(sql`
    SELECT ei.id, cf."appFieldKey", fv."valueText", fv."valueNumber", fv."valueBoolean",
           fv."valueDate", fv."optionId"
    FROM "FieldValue" fv
    JOIN "CustomField" cf ON cf.id = fv."fieldId"
    JOIN "EntityInstance" ei ON ei.id = fv."entityId"
    JOIN "EntityDefinition" ed ON ed.id = cf."entityDefinitionId"
    WHERE ed."apiSlug" = 'shopify_orders'
      AND cf."appFieldKey" IN ('name','shipmentCount','isSplitShipment','firstFulfilledAt','lastFulfilledAt','paymentGateways')
    ORDER BY ei.id, cf."appFieldKey"
  `)
  const byInstance = new Map<string, Record<string, unknown>>()
  for (const r of split.rows as any[]) {
    const cur = byInstance.get(r.id) ?? {}
    cur[r.appFieldKey] =
      r.valueText ?? r.valueNumber ?? r.valueBoolean ?? r.valueDate ?? r.optionId ?? null
    byInstance.set(r.id, cur)
  }
  console.log('\n=== orders with fulfillment data ===')
  for (const [, v] of byInstance) {
    if (v.shipmentCount === undefined || Number(v.shipmentCount) === 0) continue
    console.log(`  ${JSON.stringify(v)}`)
  }

  console.log('\n=== line items that shipped ===')
  const lines = await db.execute(sql`
    SELECT ei.id, cf."appFieldKey", fv."valueText", fv."valueNumber", fv."valueDate"
    FROM "FieldValue" fv
    JOIN "CustomField" cf ON cf.id = fv."fieldId"
    JOIN "EntityInstance" ei ON ei.id = fv."entityId"
    JOIN "EntityDefinition" ed ON ed.id = cf."entityDefinitionId"
    WHERE ed."apiSlug" = 'shopify_line_items'
      AND cf."appFieldKey" IN ('lineItems.shopifyId','lineItems.quantity','lineItems.fulfilledQuantity',
                               'lineItems.shipmentCount','lineItems.trackingNumber','lineItems.fulfilledAt',
                               'lineItems.lastFulfilledAt','lineItems.fulfillableQuantity')
    ORDER BY ei.id
  `)
  const byLine = new Map<string, Record<string, unknown>>()
  for (const r of lines.rows as any[]) {
    const cur = byLine.get(r.id) ?? {}
    cur[r.appFieldKey.replace('lineItems.', '')] =
      r.valueText ?? r.valueNumber ?? r.valueDate ?? null
    byLine.set(r.id, cur)
  }
  for (const [, v] of byLine) {
    if (!v.shipmentCount || Number(v.shipmentCount) === 0) continue
    console.log(`  ${JSON.stringify(v)}`)
  }

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
