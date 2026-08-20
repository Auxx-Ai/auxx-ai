// packages/lib/scripts/check-shopify-tags.ts
// Dev check: what did the last sync actually write for the Shopify order/product TAGS
// columns, and how many distinct tag values landed per record?

import { database as db } from '@auxx/database'
import { sql } from 'drizzle-orm'

const CONNECTOR_ID = process.env.CONNECTOR_ID ?? 't0e33r78tehnzcrbkqur0tcc'

async function main() {
  const runs = await db.execute(sql`
    SELECT id, status, fetched, created, updated, skipped, failed, "startedAt", "finishedAt"
    FROM "DataConnectorRun" WHERE "dataConnectorId" = ${CONNECTOR_ID}
    ORDER BY "startedAt" DESC NULLS LAST LIMIT 3
  `)
  console.log('\n=== recent runs ===')
  for (const r of runs.rows as any[]) {
    console.log(
      `  ${r.startedAt?.toISOString?.() ?? r.startedAt}  ${r.status}  fetched=${r.fetched} updated=${r.updated} skipped=${r.skipped} failed=${r.failed}`
    )
  }

  const tags = await db.execute(sql`
    SELECT ed."apiSlug" AS def, fv."entityId", fv."optionId"
    FROM "FieldValue" fv
    JOIN "CustomField" cf ON cf.id = fv."fieldId"
    JOIN "EntityDefinition" ed ON ed.id = cf."entityDefinitionId"
    WHERE cf."appFieldKey" = 'tags' AND ed."apiSlug" IN ('shopify_orders','shopify_products')
    ORDER BY ed."apiSlug", fv."entityId", fv."optionId"
  `)

  const byRecord = new Map<string, string[]>()
  for (const r of tags.rows as any[]) {
    const key = `${r.def}:${r.entityId}`
    byRecord.set(key, [...(byRecord.get(key) ?? []), r.optionId])
  }

  console.log(`\n=== tag values: ${tags.rows.length} rows across ${byRecord.size} records ===`)
  let compound = 0
  for (const [key, values] of byRecord) {
    const bad = values.filter((v) => v?.includes(','))
    if (bad.length) compound++
    console.log(`  ${bad.length ? '🛑' : '  '} ${key.split(':')[0]} → ${JSON.stringify(values)}`)
  }
  console.log(
    `\n${compound === 0 ? '✅ no compound (comma-bearing) tag values' : `🛑 ${compound} record(s) still hold a compound tag value`}`
  )

  const addr = await db.execute(sql`
    SELECT cf."appFieldKey", count(fv.id) AS n
    FROM "CustomField" cf
    LEFT JOIN "FieldValue" fv ON fv."fieldId" = cf.id
    JOIN "EntityDefinition" ed ON ed.id = cf."entityDefinitionId"
    WHERE ed."apiSlug" = 'shopify_orders' AND cf."appFieldKey" IN ('shippingAddress','billingAddress')
    GROUP BY 1 ORDER BY 1
  `)
  console.log('\n=== ADDRESS_STRUCT (expected still 0 — separate platform bug) ===')
  for (const r of addr.rows as any[]) console.log(`  ${r.appFieldKey}: ${r.n}`)

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
