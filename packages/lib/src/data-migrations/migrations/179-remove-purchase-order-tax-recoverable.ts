// packages/lib/src/data-migrations/migrations/179-remove-purchase-order-tax-recoverable.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:179')

const PURCHASE_ORDER_ENTITY_TYPE = 'purchase_order'

/**
 * A literal, not a registry reference: the registry no longer declares this
 * field (the removal is the point), so a stored row is matched on what it was
 * actually seeded with — 168's rule.
 */
const REMOVED_SYSTEM_ATTRIBUTE = 'purchase_order_tax_recoverable'

/** A removed field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

export interface Migration179Result extends PerOrgMigrationResult {
  /** 1 when this org still carried the field, 0 when it was already gone. */
  fieldsRemoved: number
}

/**
 * Migration 179: remove `purchase_order_tax_recoverable`, the unread PO flag
 * 74-D8 deletes (`plans/accounting/tasks/done/74-what-73-left-open.md` §5).
 *
 * Tax on a bill always debits `purchase_tax`, so nothing ever read the flag: a
 * person who ticked it was told the tax would be reclaimed and it was expensed
 * regardless. A VAT unit, if a non-US org ever needs one, starts from a clean
 * field.
 *
 * `CustomField` rows are seeded per org and a registry edit alone deletes none,
 * hence the migration. `FieldValue.fieldId` is `ON DELETE CASCADE`
 * (`field-value.ts`), so the delete takes every stored tick with it — no
 * `FieldValue` sweep, the same as 166's Part A and 168.
 *
 * Idempotent: the delete is gated on the row still existing (`.returning()`
 * reports 0 for a field already gone), and an org short of the def is a SKIP,
 * never a throw.
 */
export const migration179RemovePurchaseOrderTaxRecoverable: PerOrgMigration = {
  id: '179-remove-purchase-order-tax-recoverable',
  description:
    'Removes purchase_order_tax_recoverable, the PO flag nothing read - tax on a bill always ' +
    'debits purchase_tax, so the tick was never honoured ' +
    '(plans/accounting/tasks/done/74-what-73-left-open.md §5, 74-D8).',

  async up(db: Database, organizationId: string): Promise<Migration179Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const def = existing.entityDefs.get(PURCHASE_ORDER_ENTITY_TYPE)
    // Absent rather than failed: a fresh install never seeds this field at all.
    if (!def) return { ...state, alreadyUpToDate: true, fieldsRemoved: 0 }

    const removed = await db
      .delete(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, def.id),
          eq(schema.CustomField.systemAttribute, REMOVED_SYSTEM_ATTRIBUTE)
        )
      )
      .returning({ id: schema.CustomField.id })

    const fieldsRemoved = removed.length
    if (fieldsRemoved > 0) {
      // The delete bypasses the org cache; a stale `customFields`/`resources`
      // entry would keep serving a field that no longer exists.
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 179 applied', { organizationId, fieldsRemoved })
    }

    return { ...state, alreadyUpToDate: fieldsRemoved === 0, fieldsRemoved }
  },
}
