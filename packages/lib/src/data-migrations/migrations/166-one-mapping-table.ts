// packages/lib/src/data-migrations/migrations/166-one-mapping-table.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { BANK_ACCOUNT_FIELDS } from '../../resources/registry/resources/bank-account-fields'
import { PAYOUT_FIELDS } from '../../resources/registry/resources/payout-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import { buildFieldOptions } from '../../seed/entity-seeder/utils'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:166')

const PAYMENT_GATEWAY_ENTITY_TYPE = 'payment_gateway'
const BANK_ACCOUNT_ENTITY_TYPE = 'bank_account'
const PAYOUT_ENTITY_TYPE = 'payout'

/**
 * §4.3: the six `payment_gateway` fields the rail scope replaces. Literals,
 * not registry references - the registry no longer declares them, and this is
 * what a stored row is matched on.
 */
const REMOVED_GATEWAY_ATTRIBUTES = [
  'payment_gateway_clearing_account',
  'payment_gateway_fee_account',
  'payment_gateway_settlement_source',
  'payment_gateway_settlement_account',
  'payment_gateway_settlement_currency',
  'payment_gateway_settlement_bank_account',
] as const

/**
 * §4.3: the inverse half of the removed `settlementBankAccount` relationship -
 * confirmed against `bank-account-fields.ts` before this migration was
 * written (`inverseResourceFieldId: 'payment_gateway:settlementBankAccount'`).
 * Both halves are removed in this one migration, so there is no window where
 * one side dangles.
 */
const REMOVED_BANK_INVERSE_ATTRIBUTE = 'bank_account_settlement_gateways'

/** §4.4: the field this migration RETYPES in place, never created fresh. */
const OLD_STRIPE_ATTRIBUTE = 'bank_account_stripe_external_account_id'
const NEW_SETTLEMENT_DESTINATIONS_ATTRIBUTE = 'bank_account_settlement_destinations'

/** §4.5: the pure widen - nothing to backfill, nothing has ever written it. */
const NEW_PAYOUT_FIELD_KEYS = ['destinationMismatch'] as const

/** A changed or new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

export interface Migration166Result extends PerOrgMigrationResult {
  /** Of the six §4.3 fields, how many existed and were deleted (0-6). */
  gatewayFieldsRemoved: number
  /** Whether the §4.3 inverse `bank_account.settlementGateways` was found and dropped. */
  bankInverseFieldRemoved: boolean
  /** Whether §4.4's retype ran (false when the org has no `stripeExternalAccountId` field left). */
  bankFieldRetyped: boolean
  /** `FieldValue` rows moved from `valueText` to `optionId` by the §4.4 retype. */
  settlementValuesMigrated: number
}

/**
 * Migration 166: the one entity migration `plans/accounting/tasks/58-one-mapping-table.md`
 * §4.8 calls for - §4.3's six gateway removals, §4.4's bank-account retype with its Stripe
 * value carried into the new tag set, and §4.5's payout field, all in one pass because the
 * removals cannot precede the last reader of the fields (U3/U4/U6) and bundling the two new
 * fields in means they land at the same moment (§8 note under the units table).
 *
 * ## Ordering against the Drizzle migration
 *
 * `packages/database/drizzle/0390_one_mapping_table.sql` reads these same six fields to mint
 * scoped `GlRoleAssignment` rows BEFORE this migration deletes them, and its own comment says
 * so ("entity migration 167 (U7, not this migration) removes once every reader has moved off
 * them" - off by one against this file's id, immaterial to the ordering question). Verified:
 * the two run through ENTIRELY SEPARATE mechanisms with no code path linking them. `pnpm
 * db:migrate` applies `.sql` files under `packages/database/drizzle/` against Drizzle's own
 * `__drizzle_migrations` ledger, invoked by a human or a deploy script; `runPendingDataMigrations`
 * (`data-migrations/run-pending-data-migrations.ts`) walks `ALL_DATA_MIGRATIONS` against the
 * app's own `DataMigration` ledger, fired in-process at worker boot and hourly thereafter
 * (`apps/worker/src/boot/run-pending-migrations.ts`). Neither waits on the other, and this
 * migration asserts nothing about 0390 having run.
 *
 * 🛑 **Ordering is NOT guaranteed by the framework - it holds only by deploy discipline**
 * (`db:migrate` before the build that ships this file). If this migration ran first, 0390's
 * inserts would simply find no matching `CustomField` row (the JOIN on `systemAttribute`
 * yields nothing) and silently mint ZERO rail rows for every org's clearing/fee/bank mapping -
 * no error, no ledger failure, just data loss. Nothing in either migration detects that case.
 *
 * ## Part B, why RETYPE in place rather than create-new-and-delete
 *
 * TEXT and TAGS store a value in DIFFERENT `FieldValue` columns:
 * `156-payment-gateway-fee-treatment.ts`'s stamp writes a SINGLE_SELECT value to `optionId`
 * ALONE, "not `valueText` ... a value written to valueText as well would be a row shaped
 * unlike every row the application writes" - TAGS is the same option-backed shape
 * (`field-value-helpers.ts` cases SINGLE_SELECT/MULTI_SELECT/TAGS together). So flipping
 * `CustomField.type` alone would leave every existing Stripe id sitting in `valueText`, which
 * nothing reads for a TAGS field - orphaned in place, not lost, but invisible. Retyping the
 * SAME row (not a new one) keeps its id, so `FieldValue.fieldId`'s cascade FK needs no re-link,
 * and `retypeSettlementDestinations` below copies each row's value across in the same pass.
 *
 * Idempotent: Part A's deletes are gated on the row still existing, Part B's retype is gated on
 * finding the OLD `systemAttribute` (a re-run finds the NEW one and does nothing), and Part C's
 * `ensureCustomFields` is INSERT-only.
 */
export const migration166OneMappingTable: PerOrgMigration = {
  id: '166-one-mapping-table',
  description:
    'Removes the six payment_gateway settlement fields the rail-scoped GlRoleAssignment ' +
    'replaces, retypes bank_account.stripeExternalAccountId into the TAGS ' +
    'settlementDestinations (carrying existing Stripe ids from valueText into optionId), and ' +
    'adds payout.destinationMismatch for D7 (plans/accounting/tasks/58-one-mapping-table.md ' +
    '§4.3, §4.4, §4.5)',

  async up(db: Database, organizationId: string): Promise<Migration166Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // Part A - §4.3. `FieldValue.fieldId` is ON DELETE CASCADE (field-value.ts:58), so
    // deleting these CustomField rows takes every value with them; no FieldValue sweep needed.
    // ⚠️ Drizzle `0390` READS these six fields to mint each rail's rows and must run first.
    // Deploy applies `db:migrate` before this sweep; the two ledgers do not check each other.
    const gatewayDef = existing.entityDefs.get(PAYMENT_GATEWAY_ENTITY_TYPE)
    const gatewayFieldsRemoved = gatewayDef
      ? (
          await db
            .delete(schema.CustomField)
            .where(
              and(
                eq(schema.CustomField.organizationId, organizationId),
                eq(schema.CustomField.entityDefinitionId, gatewayDef.id),
                inArray(schema.CustomField.systemAttribute, REMOVED_GATEWAY_ATTRIBUTES)
              )
            )
            .returning({ id: schema.CustomField.id })
        ).length
      : 0

    const bankDef = existing.entityDefs.get(BANK_ACCOUNT_ENTITY_TYPE)
    const bankInverseFieldRemoved = bankDef
      ? (
          await db
            .delete(schema.CustomField)
            .where(
              and(
                eq(schema.CustomField.organizationId, organizationId),
                eq(schema.CustomField.entityDefinitionId, bankDef.id),
                eq(schema.CustomField.systemAttribute, REMOVED_BANK_INVERSE_ATTRIBUTE)
              )
            )
            .returning({ id: schema.CustomField.id })
        ).length > 0
      : false

    // Part B - §4.4
    const { retyped: bankFieldRetyped, valuesMigrated: settlementValuesMigrated } = bankDef
      ? await retypeSettlementDestinations(db, organizationId, bankDef.id)
      : { retyped: false, valuesMigrated: 0 }

    // Part C - §4.5
    const payoutDef = existing.entityDefs.get(PAYOUT_ENTITY_TYPE)
    if (payoutDef) {
      const fields: Record<string, ResourceField> = {}
      for (const key of NEW_PAYOUT_FIELD_KEYS) {
        const field = PAYOUT_FIELDS[key]
        if (!field) {
          throw new Error(`payout-fields registry is missing the key "${key}" (migration 166)`)
        }
        fields[key] = field
      }
      await ensureCustomFields(
        db,
        organizationId,
        PAYOUT_ENTITY_TYPE,
        payoutDef.id,
        fields,
        existing,
        state
      )
    }

    const changed =
      gatewayFieldsRemoved > 0 ||
      bankInverseFieldRemoved ||
      bankFieldRetyped ||
      state.fieldsCreated > 0

    if (changed) {
      // Deletes, the retype, and the new field all bypass the org cache; a stale
      // `customFields`/`resources` entry would keep serving the removed shapes.
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 166 applied', {
        organizationId,
        gatewayFieldsRemoved,
        bankInverseFieldRemoved,
        bankFieldRetyped,
        settlementValuesMigrated,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return {
      ...state,
      alreadyUpToDate: !changed,
      gatewayFieldsRemoved,
      bankInverseFieldRemoved,
      bankFieldRetyped,
      settlementValuesMigrated,
    }
  },
}

/**
 * §4.4: retype `bank_account.stripeExternalAccountId` (TEXT) into
 * `settlementDestinations` (TAGS) on the SAME `CustomField` row, then move
 * every existing value from `valueText` to `optionId` in one UPDATE - see the
 * migration's own docblock for why the column differs and an in-place type
 * flip alone would orphan the data.
 */
async function retypeSettlementDestinations(
  db: Database,
  organizationId: string,
  bankAccountDefId: string
): Promise<{ retyped: boolean; valuesMigrated: number }> {
  const field = await db.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.entityDefinitionId, bankAccountDefId),
      eq(schema.CustomField.systemAttribute, OLD_STRIPE_ATTRIBUTE)
    ),
    columns: { id: true },
  })
  // Already retyped (a re-run finds the NEW attribute, not this one), or the org's
  // bank_account def predates the field entirely - a fresh install seeds the new shape.
  if (!field) return { retyped: false, valuesMigrated: 0 }

  const newField = BANK_ACCOUNT_FIELDS.settlementDestinations
  if (!newField) {
    throw new Error(
      'bank-account-fields registry is missing settlementDestinations (migration 166)'
    )
  }

  const now = new Date()
  await db
    .update(schema.CustomField)
    .set({
      name: newField.label,
      type: newField.fieldType!,
      description: newField.description,
      systemAttribute: NEW_SETTLEMENT_DESTINATIONS_ATTRIBUTE,
      options: buildFieldOptions(newField),
      updatedAt: now,
    })
    .where(eq(schema.CustomField.id, field.id))

  const migrated = await db
    .update(schema.FieldValue)
    .set({ optionId: sql`trim(${schema.FieldValue.valueText})`, valueText: null, updatedAt: now })
    .where(
      and(
        eq(schema.FieldValue.fieldId, field.id),
        isNotNull(schema.FieldValue.valueText),
        sql`${schema.FieldValue.valueText} <> ''`
      )
    )
    .returning({ id: schema.FieldValue.id })

  return { retyped: true, valuesMigrated: migrated.length }
}
