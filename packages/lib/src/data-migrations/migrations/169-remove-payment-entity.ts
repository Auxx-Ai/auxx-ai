// packages/lib/src/data-migrations/migrations/169-remove-payment-entity.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:169')

/**
 * The two relationships into the hidden `payment` entity mirror that
 * MIGRATION follow-up 9 retires. `payment`'s own field registry
 * (`resources/payment-fields.ts`) went with the legacy payment lane in
 * accounting migration step 0 - these forward sides are the last thing
 * pointing at it.
 */
const REMOVED_RELATIONSHIPS: readonly { entityType: string; systemAttribute: string }[] = [
  { entityType: 'invoice', systemAttribute: 'invoice_payments' },
  { entityType: 'bank_deposit', systemAttribute: 'bank_deposit_payments' },
]

/** A removed field or def is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources', 'entityDefs', 'entityDefSlugs'] as const

export interface Migration169Result extends PerOrgMigrationResult {
  /** Of the two relationships, how many existed on this org and were deleted (0-2). */
  relationshipsRemoved: number
  /** Whether this org had a `payment` def that was not yet archived. */
  paymentDefArchived: boolean
  /** Leftover `payment` instances archived alongside the def. */
  instancesArchived: number
}

/**
 * Migration 169: finish retiring the hidden `payment` entity (MIGRATION.md
 * follow-up 9, TARGET §1).
 *
 * `createBankDeposit` and the invoice payments card were rewritten onto
 * `MoneyTransaction` directly (`bankDepositInstanceId`, `listInvoiceMoneyPayments`)
 * before this migration runs, so there is nothing left reading `invoice.payments`
 * or `bank_deposit.payments`. This drops the two `CustomField` rows - which takes
 * every `FieldValue` under them via `ON DELETE CASCADE`, the same as migration
 * 168 - and archives the `payment` `EntityDefinition` itself, plus any instance
 * still under it, for orgs old enough to have one.
 *
 * Archived, not deleted outright: an `EntityDefinition`/`EntityInstance` archive
 * is the codebase's normal soft-delete, and archiving costs nothing a hard
 * delete would have bought here - nothing else references a `payment` instance
 * by FK (`GlPostingLine.sourceType/sourceId` is a bare text audit column, TARGET
 * §1, unaffected either way).
 *
 * Idempotent: each delete/archive is gated on the row still being there, and an
 * org short of a def is a SKIP on that piece alone, never a throw - a fresh
 * install (past step 0) never seeded `payment` fields or a `payment` def with
 * fields at all.
 */
export const migration169RemovePaymentEntity: PerOrgMigration = {
  id: '169-remove-payment-entity',
  description:
    'Finishes retiring the hidden payment entity - drops the invoice.payments and ' +
    'bank_deposit.payments relationship fields and archives the payment EntityDefinition ' +
    '(and any leftover instance) per org. createBankDeposit and the invoice payments card ' +
    'read MoneyTransaction directly now (MIGRATION.md follow-up 9).',

  async up(db: Database, organizationId: string): Promise<Migration169Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    let relationshipsRemoved = 0
    for (const { entityType, systemAttribute } of REMOVED_RELATIONSHIPS) {
      const def = existing.entityDefs.get(entityType)
      if (!def) continue // Absent rather than failed: a fresh install never seeds this field.

      const removed = await db
        .delete(schema.CustomField)
        .where(
          and(
            eq(schema.CustomField.organizationId, organizationId),
            eq(schema.CustomField.entityDefinitionId, def.id),
            eq(schema.CustomField.systemAttribute, systemAttribute)
          )
        )
        .returning({ id: schema.CustomField.id })
      relationshipsRemoved += removed.length
    }

    let paymentDefArchived = false
    let instancesArchived = 0
    const paymentDef = existing.entityDefs.get('payment')
    if (paymentDef) {
      const archivedDefs = await db
        .update(schema.EntityDefinition)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(schema.EntityDefinition.organizationId, organizationId),
            eq(schema.EntityDefinition.id, paymentDef.id),
            isNull(schema.EntityDefinition.archivedAt)
          )
        )
        .returning({ id: schema.EntityDefinition.id })
      paymentDefArchived = archivedDefs.length > 0

      const archivedInstances = await db
        .update(schema.EntityInstance)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, paymentDef.id),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .returning({ id: schema.EntityInstance.id })
      instancesArchived = archivedInstances.length
    }

    const changed = relationshipsRemoved > 0 || paymentDefArchived || instancesArchived > 0
    if (changed) {
      // Bypasses the org cache; a stale `resources`/`entityDefs` entry would
      // keep serving a relationship or a def that no longer resolves.
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 169 applied', {
        organizationId,
        relationshipsRemoved,
        paymentDefArchived,
        instancesArchived,
      })
    }

    return {
      ...state,
      alreadyUpToDate: !changed,
      relationshipsRemoved,
      paymentDefArchived,
      instancesArchived,
    }
  },
}
