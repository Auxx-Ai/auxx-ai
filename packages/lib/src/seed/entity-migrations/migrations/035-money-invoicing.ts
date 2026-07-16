// packages/lib/src/seed/entity-migrations/migrations/035-money-invoicing.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { INVOICE_FIELDS } from '../../../resources/registry/resources/invoice-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { PAYMENT_FIELDS } from '../../../resources/registry/resources/payment-fields'
import { WORK_ORDER_FIELDS } from '../../../resources/registry/resources/work-order-fields'
import { SystemUserService } from '../../../users/system-user-service'
import { DEFAULT_VIEW_CONFIGS } from '../../default-view-configs'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureDefaultTableViews,
  ensureEntityDefinitions,
  ensureFieldViews,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:035')

/**
 * Migration 035: Money MI1 invoicing entities — `invoice` and `payment`.
 *
 * Def + fields + contact/work_order/line_item inverse relationships + default field/table
 * views. Also adds the `line_item.invoice` owning parent relation and the `contact.invoices` /
 * `work_order.invoices` inverse fields — none of these existed when 032 ran, since the
 * `invoice` def didn't exist yet.
 *
 * No DDL — these are pure EntityInstance defs. The `PaymentTransaction` ledger DDL is a
 * separate drizzle migration (money MI1 build spec §E.1).
 *
 * See plans/dispatch/money/06-mi1-build.md §D.
 */
export const migration035MoneyInvoicing: EntityMigration = {
  id: '035-money-invoicing',
  description: 'Add invoice and payment as system entities (Money MI1 invoicing)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => ['invoice', 'payment'].includes(e.entityType)),
      existing,
      state
    )

    // Pull inverse targets into the id map so linking can resolve them
    for (const type of ['contact', 'work_order', 'line_item'] as const) {
      const def = existing.entityDefs.get(type)
      if (def) entityDefIds.set(type, def.id)
    }

    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
    >()
    const merge = (m: typeof allFieldMaps) => {
      for (const [k, v] of m) allFieldMaps.set(k, v)
    }

    const invoiceDefId = entityDefIds.get('invoice')
    if (invoiceDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'invoice',
          invoiceDefId,
          INVOICE_FIELDS,
          existing,
          state
        )
      )
    }

    const paymentDefId = entityDefIds.get('payment')
    if (paymentDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'payment',
          paymentDefId,
          PAYMENT_FIELDS,
          existing,
          state
        )
      )
    }

    // Existing-def additions — fields that reference the newly-created invoice def above.
    const lineItemDefId = entityDefIds.get('line_item')
    if (lineItemDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'line_item',
          lineItemDefId,
          // Allocation-backed billing keeps provenance in InvoiceLineAllocation. Only the
          // invoice-owned line parent relation remains in the clean-cutover registry.
          { invoice: LINE_ITEM_FIELDS.invoice! },
          existing,
          state
        )
      )
    }
    const contactDefId = entityDefIds.get('contact')
    if (contactDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'contact',
          contactDefId,
          { invoices: CONTACT_FIELDS.invoices! },
          existing,
          state
        )
      )
    }
    const workOrderDefId = entityDefIds.get('work_order')
    if (workOrderDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'work_order',
          workOrderDefId,
          { invoices: WORK_ORDER_FIELDS.invoices! },
          existing,
          state
        )
      )
    }

    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)
    await linkDisplayFields(db, ['invoice', 'payment'], entityDefIds, allFieldMaps)

    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    await ensureFieldViews(
      db,
      organizationId,
      systemUserId,
      [
        {
          entityType: 'invoice',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: [
            'id',
            'created_at',
            'updated_at',
            'created_by_id',
            'invoice_line_items',
            'invoice_payments',
            'invoice_pdf_asset',
          ],
        },
        {
          entityType: 'invoice',
          contextType: 'table',
          name: 'Default Table View',
          excludeFields: [
            'id',
            'created_at',
            'updated_at',
            'created_by_id',
            'invoice_line_items',
            'invoice_payments',
            'invoice_pdf_asset',
            'invoice_notes',
            'invoice_terms',
            'invoice_discount_type',
            'invoice_discount_value',
            'invoice_tax_name',
          ],
        },
        {
          entityType: 'invoice',
          contextType: 'dialog_create',
          name: 'Default Create Dialog',
          includeFields: ['invoice_contact', 'invoice_work_order', 'invoice_due_date'],
        },
        {
          entityType: 'payment',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
        },
        {
          entityType: 'payment',
          contextType: 'table',
          name: 'Default Table View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
        },
      ],
      entityDefIds,
      allFieldMaps
    )

    // Seed the table "All Invoices" + "Outstanding" saved views — without this, migrated
    // orgs fall back to the runtime plain table, not the defaults fresh orgs get from
    // `createDefaultViews`. No entries for `payment` (hidden, no records surface).
    if (invoiceDefId) {
      await ensureDefaultTableViews(
        db,
        organizationId,
        systemUserId,
        'invoice',
        invoiceDefId,
        DEFAULT_VIEW_CONFIGS.invoice,
        allFieldMaps
      )
    }

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 035 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
