// packages/lib/src/seed/entity-migrations/migrations/144-gl-account-code-optional-and-subtype.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { GL_ACCOUNT_FIELDS } from '../../../resources/registry/resources/gl-account-fields'
import { ensureCustomFields, fieldKey, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:144')

/** The def and the three attributes this migration reads or writes on it. */
const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'
const GL_ACCOUNT_CODE_ATTRIBUTE = 'gl_account_code'
const GL_ACCOUNT_TYPE_ATTRIBUTE = 'gl_account_type'

/**
 * `GlAccountType.EXPENSE` and `GlAccountSubtype.COST_OF_GOODS_SOLD`, as
 * literals. A migration must still make sense years after the enum it might
 * have imported has changed - `132-card-clearing-rename.ts` and
 * `137-fulfillment-facts.ts` hold their stored strings the same way, for the
 * same reason: these are the VALUES this migration reads and writes, not a
 * reference to whatever the constant currently says.
 */
const EXPENSE_ACCOUNT_TYPE = 'expense'
const COGS_SUBTYPE = 'cost_of_goods_sold'

/**
 * Migration 144: `gl_account_code` becomes optional, and `gl_account` gains a
 * `subtype` field, backfilled onto every existing 5xxx expense account.
 *
 * `plans/accounting/tasks/15-the-account-id-is-the-identity.md` §5.
 *
 * ## Why a migration, and not just the registry edit
 *
 * Registry edits reach no existing org on their own - `ensureCustomFields` is
 * INSERT-only and ships nothing to a `CustomField` row already sitting in the
 * database, and flipping `nullable`/`required` in `gl-account-fields.ts`
 * changes only what a FRESH org gets. Every org that ran the accounting setup
 * wizard before this landed still holds a `gl_account_code` row stamped
 * `required: true` from `108-purchasing.ts`, and a `subtype` field that does
 * not exist at all. Both need a direct write, per org.
 *
 * ## What it does, per org
 *
 * 1. **`CustomField.required` false** on the `gl_account_code` field, wherever
 *    it is still `true`. The code is a label the account's owner may leave
 *    blank now (task 15 §5); `gl_account_id` is the identity.
 * 2. **`ensureCustomFields` for `gl_account.subtype`** - the second fact
 *    beyond the statement type (task 13 §3, pulled forward here), created
 *    when missing and left alone when an earlier pass already created it.
 * 3. **Backfills `cost_of_goods_sold`** onto every non-archived `gl_account`
 *    instance whose `gl_account_type` is `expense` and whose
 *    `gl_account_code` starts with `'5'`, and which carries no
 *    `gl_account_subtype` value yet. `profit-and-loss.ts` used to classify
 *    COGS by testing that same code prefix - a rule that throws the moment a
 *    chart has no codes at all, which is exactly what this brief makes
 *    possible. The backfill is what lets the P&L keep grouping COGS the way
 *    every existing chart already implied, once the prefix stops being
 *    readable.
 *
 * ## Bulk, never a per-row loop
 *
 * One SELECT reads every non-archived `gl_account` instance in the org, one
 * SELECT reads every value on the type, code and (once created) subtype
 * fields across those instances in a single `fieldId IN (...)`, and the
 * decision of which instances qualify happens in memory
 * ({@link backfillCogsSubtype}). The write that follows is one bulk
 * `INSERT ... VALUES` for every qualifying account, never one statement per
 * row - the same shape `143-gl-pointers-hold-ids.ts` and `019-tag-scope.ts`
 * use for the same reason.
 *
 * ## Idempotent
 *
 * A re-run finds `gl_account_code` already `required: false`, `subtype`
 * already created, and every qualifying account already carrying a
 * `gl_account_subtype` value - `alreadyUpToDate: true`, nothing written.
 * Safe to re-apply with
 * `packages/lib/scripts/run-entity-migration.ts --id 144-gl-account-code-optional-and-subtype`.
 */
export const migration144GlAccountCodeOptionalAndSubtype: EntityMigration = {
  id: '144-gl-account-code-optional-and-subtype',
  description:
    'Makes gl_account_code optional (task 15 §5) and adds gl_account.subtype, backfilled as ' +
    'cost_of_goods_sold onto every non-archived expense account whose code still starts with ' +
    "'5' - preserving the COGS grouping the P&L used to derive from that prefix before the " +
    'code became optional',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const glAccountDef = existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)
    if (!glAccountDef) {
      return { ...state, alreadyUpToDate: true }
    }

    // (a) The code stops being required.
    const codeFieldsRelaxed = await db
      .update(schema.CustomField)
      .set({ required: false })
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, glAccountDef.id),
          eq(schema.CustomField.systemAttribute, GL_ACCOUNT_CODE_ATTRIBUTE),
          eq(schema.CustomField.required, true)
        )
      )
      .returning({ id: schema.CustomField.id })

    // (b) The subtype field, created when missing.
    const subtypeFieldDef = GL_ACCOUNT_FIELDS.subtype
    if (!subtypeFieldDef) {
      throw new Error("gl-account-fields registry is missing the key 'subtype' (migration 144)")
    }
    const subtypeFieldMap = await ensureCustomFields(
      db,
      organizationId,
      GL_ACCOUNT_ENTITY_TYPE,
      glAccountDef.id,
      { subtype: subtypeFieldDef },
      existing,
      state
    )
    const subtypeField = subtypeFieldMap.get(`${GL_ACCOUNT_ENTITY_TYPE}:${subtypeFieldDef.id}`)

    // (c) The backfill, once the field to write it to exists.
    const backfilled = subtypeField
      ? await backfillCogsSubtype(db, organizationId, glAccountDef.id, existing, subtypeField.id)
      : 0

    const changed = codeFieldsRelaxed.length > 0 || state.fieldsCreated > 0 || backfilled > 0

    if (changed) {
      // `ensureCustomFields` and the direct `CustomField` write both bypass the
      // org cache, and `UnifiedCrudHandler` resolves a field's shape from it -
      // a stale entry would keep refusing a blank code or hiding `subtype`
      // until something else evicted it. `runEntityMigrationsForOrg` does this
      // after the whole batch, but `up()` is also called directly by
      // `scripts/run-entity-migration.ts`, so do it here too (as 137 and 139 do).
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
      logger.info('Migration 144 applied', {
        organizationId,
        codeFieldsRelaxed: codeFieldsRelaxed.length,
        subtypeFieldsCreated: state.fieldsCreated,
        backfilled,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/**
 * Stamp `cost_of_goods_sold` onto every non-archived `gl_account` in this org
 * that is `expense`-typed, coded `5xxx`, and has no `gl_account_subtype`
 * value yet.
 *
 * One SELECT for the instances, one SELECT for every value on the three
 * fields across them, the match done in memory, one bulk INSERT for every
 * account that qualifies - never a per-row loop.
 */
async function backfillCogsSubtype(
  db: Database,
  organizationId: string,
  glAccountDefId: string,
  existing: Awaited<ReturnType<typeof loadExistingState>>,
  subtypeFieldId: string
): Promise<number> {
  const typeField = existing.fields.get(fieldKey(glAccountDefId, GL_ACCOUNT_TYPE_ATTRIBUTE))
  const codeField = existing.fields.get(fieldKey(glAccountDefId, GL_ACCOUNT_CODE_ATTRIBUTE))
  // Neither should be missing on an org that has a `gl_account` def at all -
  // both were created alongside it by migration 108 - but an org mid-migration
  // is not a crash, it is nothing to backfill yet.
  if (!typeField || !codeField) return 0

  const instances = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, glAccountDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  if (instances.length === 0) return 0
  const instanceIds = instances.map((row) => row.id)

  const rows = await db
    .select({
      fieldId: schema.FieldValue.fieldId,
      entityId: schema.FieldValue.entityId,
      valueText: schema.FieldValue.valueText,
      optionId: schema.FieldValue.optionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.fieldId, [typeField.id, codeField.id, subtypeFieldId]),
        inArray(schema.FieldValue.entityId, instanceIds)
      )
    )

  const expenseTypedIds = new Set<string>()
  const codeByEntityId = new Map<string, string>()
  const alreadySubtyped = new Set<string>()
  for (const row of rows) {
    if (row.fieldId === typeField.id && row.optionId === EXPENSE_ACCOUNT_TYPE) {
      expenseTypedIds.add(row.entityId)
    } else if (row.fieldId === codeField.id && row.valueText) {
      codeByEntityId.set(row.entityId, row.valueText)
    } else if (row.fieldId === subtypeFieldId) {
      alreadySubtyped.add(row.entityId)
    }
  }

  const toInsert = instanceIds.filter((entityId) => {
    if (alreadySubtyped.has(entityId)) return false
    if (!expenseTypedIds.has(entityId)) return false
    return codeByEntityId.get(entityId)?.startsWith('5') ?? false
  })
  if (toInsert.length === 0) return 0

  const now = new Date()
  await db.insert(schema.FieldValue).values(
    toInsert.map((entityId) => ({
      organizationId,
      entityId,
      entityDefinitionId: glAccountDefId,
      fieldId: subtypeFieldId,
      sortKey: generateKeyBetween(null, null),
      optionId: COGS_SUBTYPE,
      updatedAt: now,
    }))
  )

  return toInsert.length
}
