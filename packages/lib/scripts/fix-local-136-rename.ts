// packages/lib/scripts/fix-local-136-rename.ts
//
// DEV ONLY. Repairs a local database on which entity migration 136 ran BEFORE
// its `refund` / `refund_line` defs were renamed to `credit_memo` /
// `credit_memo_line` (plans/accounting/tasks/10-credit-memos.md §4.2).
//
// 136 is recorded `applied` in the `DataMigration` ledger, so the ledger will
// never re-run it, and `ensureCustomFields` is INSERT-only keyed by system
// attribute, so the stale inverse fields `order_refunds` and
// `line_item_refund_lines` would otherwise linger forever beside the new ones.
// Production never saw the old names: it gets the corrected 136 through the
// ledger on its first run, which is why this is a script and not a migration.
//
// Per org it:
//   1. counts `EntityInstance` rows on the `refund` and `refund_line` defs and
//      ABORTS before writing anything if any org has one (nothing has ever
//      written a row; if one exists, stop and look);
//   2. deletes the two `EntityDefinition` rows. They are system defs, which
//      `deleteEntityDefinitionDeep` refuses, so this is a plain delete.
//      `CustomField.entityDefinitionId` and `FieldValue.fieldId` both cascade,
//      and every other table that references `EntityDefinition.id` cascades or
//      sets null, but the def's `CustomField` rows are deleted explicitly first
//      so the count of what went is printed;
//   3. deletes the stale inverse `CustomField` rows by system attribute:
//      `order_refunds` on `order`, `line_item_refund_lines` on `line_item`;
//   4. drops the org caches the defs and fields are served from.
//
// Then run the corrected migration by hand, which creates the renamed defs,
// links and asserts the inverses, and stamps `onDelete`:
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/run-entity-migration.ts --id 136-refunds-and-tax-lines
//
// Idempotent: a second run finds nothing to delete and says so.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/fix-local-136-rename.ts

import { closePools, database, schema } from '@auxx/database'
import { and, count, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../src/cache'

/** The defs the first cut of 136 created under their old names. */
const STALE_ENTITY_TYPES = ['refund', 'refund_line'] as const

/** The inverse fields the first cut of 136 added to defs that still exist. */
const STALE_INVERSE_FIELDS: readonly { entityType: string; systemAttribute: string }[] = [
  { entityType: 'order', systemAttribute: 'order_refunds' },
  { entityType: 'line_item', systemAttribute: 'line_item_refund_lines' },
]

const CACHE_KEYS = ['entityDefs', 'entityDefSlugs', 'customFields', 'resources'] as const

interface StaleDef {
  id: string
  entityType: string
}

interface OrgPlan {
  organizationId: string
  staleDefs: StaleDef[]
  /** Rows on the stale defs, which must be zero everywhere before anything is deleted. */
  instanceRows: number
  staleInverseFieldIds: string[]
}

async function planOrg(organizationId: string): Promise<OrgPlan> {
  const staleDefs = await database
    .select({ id: schema.EntityDefinition.id, entityType: schema.EntityDefinition.entityType })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        inArray(schema.EntityDefinition.entityType, [...STALE_ENTITY_TYPES])
      )
    )

  let instanceRows = 0
  if (staleDefs.length > 0) {
    const [row] = await database
      .select({ n: count() })
      .from(schema.EntityInstance)
      .where(
        inArray(
          schema.EntityInstance.entityDefinitionId,
          staleDefs.map((d) => d.id)
        )
      )
    instanceRows = Number(row?.n ?? 0)
  }

  const staleInverseFieldIds: string[] = []
  for (const { entityType, systemAttribute } of STALE_INVERSE_FIELDS) {
    const rows = await database
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .innerJoin(
        schema.EntityDefinition,
        eq(schema.CustomField.entityDefinitionId, schema.EntityDefinition.id)
      )
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, entityType),
          eq(schema.CustomField.systemAttribute, systemAttribute)
        )
      )
    for (const row of rows) staleInverseFieldIds.push(row.id)
  }

  return {
    organizationId,
    staleDefs: staleDefs.map((d) => ({ id: d.id, entityType: d.entityType ?? '' })),
    instanceRows,
    staleInverseFieldIds,
  }
}

async function applyOrg(plan: OrgPlan): Promise<void> {
  const defIds = plan.staleDefs.map((d) => d.id)

  let defFieldsDeleted = 0
  let defsDeleted = 0
  if (defIds.length > 0) {
    const defFields = await database
      .delete(schema.CustomField)
      .where(inArray(schema.CustomField.entityDefinitionId, defIds))
      .returning({ id: schema.CustomField.id })
    defFieldsDeleted = defFields.length

    const defs = await database
      .delete(schema.EntityDefinition)
      .where(inArray(schema.EntityDefinition.id, defIds))
      .returning({ id: schema.EntityDefinition.id })
    defsDeleted = defs.length
  }

  let inverseFieldsDeleted = 0
  if (plan.staleInverseFieldIds.length > 0) {
    const inverses = await database
      .delete(schema.CustomField)
      .where(inArray(schema.CustomField.id, plan.staleInverseFieldIds))
      .returning({ id: schema.CustomField.id })
    inverseFieldsDeleted = inverses.length
  }

  await getOrgCache().invalidateAndRecompute(plan.organizationId, [...CACHE_KEYS])

  console.log(
    `${plan.organizationId}: deleted ${defsDeleted} defs ` +
      `(${plan.staleDefs.map((d) => d.entityType).join(', ') || 'none'}), ` +
      `${defFieldsDeleted} of their fields, ${inverseFieldsDeleted} stale inverse fields; ` +
      `caches dropped (${CACHE_KEYS.join(', ')})`
  )
}

async function main(): Promise<void> {
  const orgs = await database.select({ id: schema.Organization.id }).from(schema.Organization)
  const plans: OrgPlan[] = []
  for (const org of orgs) plans.push(await planOrg(org.id))

  // Every org is inspected before any org is written: a row on the old defs
  // anywhere means somebody wrote a refund we do not know about, and deleting
  // its def would cascade it away silently.
  const withRows = plans.filter((p) => p.instanceRows > 0)
  if (withRows.length > 0) {
    console.error('ABORT: the stale refund defs hold rows. Nothing was deleted. Stop and look:')
    for (const p of withRows) {
      console.error(
        `  ${p.organizationId}: ${p.instanceRows} EntityInstance rows on ${p.staleDefs.map((d) => d.entityType).join(', ')}`
      )
    }
    process.exitCode = 1
    return
  }

  const dirty = plans.filter((p) => p.staleDefs.length > 0 || p.staleInverseFieldIds.length > 0)
  if (dirty.length === 0) {
    console.log(`Nothing to do: none of ${orgs.length} orgs carries the old refund defs or fields.`)
    return
  }

  for (const plan of dirty) await applyOrg(plan)

  console.log(
    `\nRepaired ${dirty.length} of ${orgs.length} orgs. Now re-run the corrected migration:\n` +
      '  npx dotenv -- node --conditions source --import tsx/esm \\\n' +
      '    packages/lib/scripts/run-entity-migration.ts --id 136-refunds-and-tax-lines\n' +
      'then verify with packages/lib/scripts/audit-orphaned-children.ts.'
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
