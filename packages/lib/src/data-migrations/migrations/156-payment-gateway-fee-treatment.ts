// packages/lib/src/data-migrations/migrations/156-payment-gateway-fee-treatment.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { PAYMENT_GATEWAY_FIELDS } from '../../resources/registry/resources/payment-gateway-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:156')

const PAYMENT_GATEWAY_ENTITY_TYPE = 'payment_gateway'

/**
 * The attribute this migration stamps a value on.
 *
 * Held as a LITERAL for the reason 150, 147 and 155 hold theirs: this is the
 * value the migration matches stored rows on, not a reference to whatever the
 * registry constant is renamed to later. The field DEFINITIONS below are
 * resolved out of the registry, because those must never drift.
 */
const FEE_TREATMENT_ATTRIBUTE = 'payment_gateway_fee_treatment'

/**
 * The value every pre-existing record is stamped with.
 *
 * 🛑 A literal, not an import from `accounting/rails/client.ts`. This is the
 * value that was correct on 2026-09-14 for records written before the field
 * existed; if the vocabulary's default ever changes, the rows this migration
 * already wrote must not retroactively change with it.
 */
const NETTED = 'netted'

/**
 * The registry keys this migration provisions, in panel order.
 *
 * Named as KEYS and resolved out of {@link PAYMENT_GATEWAY_FIELDS} rather than
 * restated here, so a stored field can never disagree with the one a fresh org
 * is seeded with. The keys themselves are checked, because a rename in the
 * registry with no rename here would otherwise create one field while claiming
 * two and say nothing.
 */
const NEW_FIELD_KEYS = ['feeTreatment', 'lastFeeBookedAt'] as const

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 156: `payment_gateway` learns how its rail CHARGES, and when its
 * fees were last booked
 * (`plans/accounting/tasks/26-a-clearing-account-per-rail.md` §10).
 *
 * ## What it adds
 *
 * - **`payment_gateway_fee_treatment`**, a SINGLE_SELECT of `netted` | `billed`.
 *   Netted rails (Stripe, Shopify Payments, PayPal, Affirm) withhold their cut
 *   from the deposit, so the fee leg belongs inside the payout entry - which is
 *   the only case `buildPayoutEntry` has ever modelled. A billed rail (a
 *   traditional acquirer on statement billing) deposits GROSS and invoices for
 *   its fees weeks later, so a fee leg in the settlement entry is simply wrong,
 *   and `gross === net` is the expected arithmetic rather than a mis-read
 *   payout. 🛑 This changes the SHAPE of an entry, not a label.
 * - **`payment_gateway_last_fee_booked_at`**, a DATE, informational only.
 *   Nothing derives it yet - §11 unit 5 does - and it exists beside the
 *   `lastSettlementAt` that is already informational so the close console can
 *   show a billed rail's last fee date as a FACT rather than an alarm (§6). A
 *   rail that bills quarterly would nag two months in three and teach everyone
 *   to ignore the block.
 *
 * ## Why a migration and not just the registry edit
 *
 * `EntityDefinition` and `CustomField` rows are seeded per org from the resource
 * registry, and `ensureCustomFields` is INSERT-only - so a registry edit reaches
 * FRESH orgs and nothing else. Worse for a SINGLE_SELECT: the field renders
 * BLANK, with no options at all, until a migration writes its option list onto
 * the row. `ensureCustomFields` builds `options` from the registry field
 * (`buildFieldOptions`), so both options lists arrive with the fields.
 *
 * ## 🔑 And why it STAMPS rather than leaving null
 *
 * `netted` is the default in three places that all have to agree: the registry
 * field's `defaultValue`, `createPaymentGateway`'s `input.feeTreatment ??
 * 'netted'`, and `resolvePaymentGatewayFeeTreatment`'s read-side coercion.
 * Leaving every existing record null makes the READ the only thing holding the
 * answer, and the settings screen then shows an empty select over a rail that
 * really does net its fees. Writing the row makes the record say what it is.
 *
 * ⚠️ The read-side coercion still stands, and is not made redundant by this. It
 * is what keeps an org that has not taken this migration yet - or a record
 * created between the deploy and the run - producing the entry it produced
 * yesterday.
 *
 * ## Self-sufficient: the backfill is inline
 *
 * The stamp is in this file, in the same `up()`, and depends on no other
 * migration having run. It reads the org's own `payment_gateway` instances and
 * INSERTs one `FieldValue` per record that lacks one - one SELECT, one INSERT,
 * never a per-row loop. A handful of gateways is the normal case and there is no
 * reason it should degrade for the org that has fifteen.
 *
 * 🛑 The option key goes in `FieldValue.optionId`, not `valueText`. That is what
 * `resolvePaymentGatewayStatus` and `resolvePaymentGatewaySettlementSource`
 * already read for the other two selects on this record, and a value written to
 * `valueText` alone would read back as null through the same path.
 *
 * **No DDL.** This writes `CustomField` and `FieldValue` rows; nothing here
 * touches a Postgres table. If a `.sql` file appears under
 * `packages/database/drizzle/` for this work, something is wrong.
 *
 * ## Ordering and idempotency
 *
 * An org short of the `payment_gateway` def (entity migration 146) is a SKIP
 * rather than a failure: a fresh install brings the def and all of its fields
 * together from the registry.
 *
 * Re-running writes nothing. `ensureCustomFields` is INSERT-only, and the stamp
 * excludes every instance that already holds a `fee_treatment` value. Safe to
 * re-apply with `packages/lib/scripts/run-entity-migration.ts --id
 * 156-payment-gateway-fee-treatment`.
 */
export const migration156PaymentGatewayFeeTreatment: PerOrgMigration = {
  id: '156-payment-gateway-fee-treatment',
  description:
    'Adds payment_gateway.feeTreatment (netted | billed) and payment_gateway.lastFeeBookedAt, ' +
    'and stamps netted on every existing payment_gateway record so the default lives on the row ' +
    'rather than only in the read path. A billed rail deposits gross and its payout entry ' +
    'carries no fee leg at all (plans/accounting/tasks/26-a-clearing-account-per-rail.md §4, §10)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const gatewayDef = existing.entityDefs.get(PAYMENT_GATEWAY_ENTITY_TYPE)
    if (!gatewayDef) {
      // The org never got entity migration 146's `payment_gateway` def. A fresh
      // install brings the def and both of these fields from the registry.
      return { ...state, alreadyUpToDate: true }
    }

    const fields: Record<string, ResourceField> = {}
    for (const key of NEW_FIELD_KEYS) {
      const field = PAYMENT_GATEWAY_FIELDS[key]
      if (!field) {
        throw new Error(
          `payment-gateway-fields registry is missing the key "${key}" (migration 156)`
        )
      }
      fields[key] = field
    }

    // 🛑 The RETURN value, not the `existing` snapshot taken above: on an org
    // taking this migration for the first time the field row is created inside
    // this call, so the snapshot does not hold it. `ensureCustomFields` answers
    // with the row either way, which is what makes the stamp below work on both
    // a first run and a repair run.
    const fieldMap = await ensureCustomFields(
      db,
      organizationId,
      PAYMENT_GATEWAY_ENTITY_TYPE,
      gatewayDef.id,
      fields,
      existing,
      state
    )

    const feeTreatmentFieldId = [...fieldMap.values()].find(
      (field) => field.systemAttribute === FEE_TREATMENT_ATTRIBUTE
    )?.id
    if (!feeTreatmentFieldId) {
      throw new Error(
        `Migration 156 resolved no ${FEE_TREATMENT_ATTRIBUTE} field for org ${organizationId}`
      )
    }

    const stamped = await stampNetted(db, organizationId, gatewayDef.id, feeTreatmentFieldId)

    const changed = state.fieldsCreated > 0 || stamped > 0
    if (changed) {
      // `ensureCustomFields` and the direct `FieldValue` insert both bypass the
      // org cache, and every renderer and every read resolves a field's shape
      // from it - a stale entry would keep dropping writes to these two fields.
      // `perOrgMigration` flushes after the whole batch, but `up()` is also
      // called directly by `scripts/run-entity-migration.ts`, so do it here too
      // (as 148, 150, 151 and 155 do).
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 156 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
        stamped,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/**
 * Write `netted` onto every `payment_gateway` record that has no fee treatment
 * yet, and answer how many were written.
 *
 * ⚠️ **Archived instances are included.** `archivedAt` is not what closes a
 * rail here - `archivePaymentGateway` writes `status: 'closed'` - and a closed
 * rail still routes its own posting history, so leaving its fee treatment blank
 * would put a hole in exactly the records that are hardest to notice.
 *
 * One SELECT for the instances, one for the values already present, one INSERT
 * for the difference. Never a per-row loop.
 */
async function stampNetted(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  feeTreatmentFieldId: string
): Promise<number> {
  const instances = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId)
      )
    )
  if (instances.length === 0) return 0

  const already = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, feeTreatmentFieldId),
        inArray(
          schema.FieldValue.entityId,
          instances.map((row) => row.id)
        ),
        // A row whose `optionId` is null holds no answer, so it is not a value.
        isNotNull(schema.FieldValue.optionId)
      )
    )
  const held = new Set(already.map((row) => row.entityId))
  const missing = instances.filter((row) => !held.has(row.id))
  if (missing.length === 0) return 0

  const now = new Date()
  await db.insert(schema.FieldValue).values(
    missing.map((row) => ({
      organizationId,
      entityId: row.id,
      entityDefinitionId,
      fieldId: feeTreatmentFieldId,
      sortKey: generateKeyBetween(null, null),
      // 🛑 `optionId` and NOTHING else. That is the single column the CRUD
      // handler writes for a select (`toColumns`, `case 'option'`) and the
      // single column `resolvePaymentGatewayFeeTreatment` is fed from, so a
      // value written to `valueText` as well would be a row shaped unlike every
      // row the application writes, for no reader's benefit.
      optionId: NETTED,
      updatedAt: now,
    }))
  )
  return missing.length
}
