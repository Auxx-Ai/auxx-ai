// packages/lib/scripts/check-observed-gateway-handles.ts
//
// Diagnostic for `listObservedGatewayHandles`: runs the census straight from
// SOURCE for every org that has any `order_payment_gateways` value, so a
// failure here is the read's, not the dev server's stale lib bundle.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/check-observed-gateway-handles.ts

import { database, schema } from '@auxx/database'
import { eq, sql } from 'drizzle-orm'
import { listObservedGatewayHandles } from '../src/payment-gateways/reads'

async function main(): Promise<void> {
  const db = database

  const fields = await db
    .select({
      id: schema.CustomField.id,
      organizationId: schema.CustomField.organizationId,
      options: schema.CustomField.options,
    })
    .from(schema.CustomField)
    .where(eq(schema.CustomField.systemAttribute, 'order_payment_gateways'))

  console.log(`order_payment_gateways fields: ${fields.length}`)

  for (const field of fields) {
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.FieldValue)
      .where(eq(schema.FieldValue.fieldId, field.id))

    const raw = await db
      .selectDistinct({
        optionId: schema.FieldValue.optionId,
        valueText: schema.FieldValue.valueText,
      })
      .from(schema.FieldValue)
      .where(eq(schema.FieldValue.fieldId, field.id))

    console.log(`\n─── org ${field.organizationId}`)
    console.log(`  field ${field.id}  values=${count}  distinct=${raw.length}`)
    console.log(`  options declared: ${JSON.stringify(field.options)?.slice(0, 200)}`)
    console.log(`  distinct raw: ${JSON.stringify(raw.slice(0, 20))}`)

    const result = await listObservedGatewayHandles(db, field.organizationId)
    if (result.isErr()) {
      console.log(`  ❌ census FAILED: ${result.error.message}`)
      console.log(result.error.stack)
      continue
    }
    console.log(`  ✅ census: ${JSON.stringify(result.value)}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
