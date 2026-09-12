// packages/lib/scripts/drop-return-line-customer-fields.ts
//
// DEV ONLY. Repairs a local database on which entity migration 154 already ran
// BEFORE the owner moved `customerReason` / `customerNote` off `return_line`
// and onto `return` as a single `customerNote` (plans/money/tasks/56-return-
// lines-on-the-line-grid.md §5).
//
// 154 is recorded `applied` in the `DataMigration` ledger, so the ledger will
// never re-run it, and `ensureCustomFields` is INSERT-only and never deletes,
// so the stale `return_line_customer_reason` / `return_line_customer_note`
// `CustomField` rows would otherwise linger forever beside whatever the
// corrected 154 creates next. Production has never run 154 at all, so it never
// sees the stale fields and needs no script.
//
// Per org it deletes the `CustomField` rows whose `systemAttribute` is
// `return_line_customer_reason` or `return_line_customer_note`. Their
// `FieldValue` rows cascade with them (`FieldValue.fieldId` is
// `onDelete: 'cascade'`), which is expected to delete zero rows everywhere:
// nothing has shipped a `return_line` create/update UI yet, so no org has ever
// typed a per-line customer reason. Then it drops the org's `customFields`
// cache, without which the corrected registry stays invisible to every reader.
//
// THE TWO-STEP:
//
//   1. Run this script to remove the stale fields:
//        npx dotenv -- npx tsx packages/lib/scripts/drop-return-line-customer-fields.ts
//
//   2. Re-run migration 154 by hand so it creates `return.customerNote`. It is
//      idempotent and does not touch the `DataMigration` ledger, so running it
//      again (already `applied`) is the sanctioned way to land an in-place
//      migration correction locally:
//        npx dotenv -- node --conditions source --import tsx/esm \
//          packages/lib/scripts/run-entity-migration.ts --id 154-returns
//
// Idempotent: a second run of this script finds nothing to delete and says so.

import { closePools, database, schema } from '@auxx/database'
import { inArray } from 'drizzle-orm'
import { getOrgCache } from '../src/cache'

/** The two `return_line` attributes the owner moved off the line. */
const STALE_SYSTEM_ATTRIBUTES = [
  'return_line_customer_reason',
  'return_line_customer_note',
] as const

const CACHE_KEYS = ['customFields', 'resources'] as const

async function main(): Promise<void> {
  const staleFields = await database
    .select({
      id: schema.CustomField.id,
      organizationId: schema.CustomField.organizationId,
      systemAttribute: schema.CustomField.systemAttribute,
    })
    .from(schema.CustomField)
    .where(inArray(schema.CustomField.systemAttribute, [...STALE_SYSTEM_ATTRIBUTES]))

  if (staleFields.length === 0) {
    console.log('Nothing to do: no org carries the stale return_line customer fields.')
    return
  }

  const byOrg = new Map<string, string[]>()
  for (const field of staleFields) {
    const bucket = byOrg.get(field.organizationId) ?? []
    bucket.push(field.id)
    byOrg.set(field.organizationId, bucket)
  }

  for (const [organizationId, fieldIds] of byOrg) {
    const deletedValues = await database
      .delete(schema.FieldValue)
      .where(inArray(schema.FieldValue.fieldId, fieldIds))
      .returning({ id: schema.FieldValue.id })

    const deletedFields = await database
      .delete(schema.CustomField)
      .where(inArray(schema.CustomField.id, fieldIds))
      .returning({ id: schema.CustomField.id })

    await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])

    console.log(
      `${organizationId}: deleted ${deletedFields.length} stale field(s) and ` +
        `${deletedValues.length} value(s); caches dropped (${CACHE_KEYS.join(', ')})`
    )
  }

  console.log(
    `\nRepaired ${byOrg.size} org(s). Now re-run the corrected migration:\n` +
      '  npx dotenv -- node --conditions source --import tsx/esm \\\n' +
      '    packages/lib/scripts/run-entity-migration.ts --id 154-returns'
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePools()
    process.exit()
  })
