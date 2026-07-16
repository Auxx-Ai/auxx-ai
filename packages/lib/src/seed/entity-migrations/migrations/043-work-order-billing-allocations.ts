// packages/lib/src/seed/entity-migrations/migrations/043-work-order-billing-allocations.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, ne, or } from 'drizzle-orm'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { INVOICE_FIELDS } from '../../../resources/registry/resources/invoice-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { WORK_ORDER_FIELDS } from '../../../resources/registry/resources/work-order-fields'
import { buildFieldOptions, mapCapabilities } from '../../entity-seeder/utils'
import { ensureCustomFields, fieldKey, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:043')

const WORK_ORDER_PROJECTIONS = {
  billingState: WORK_ORDER_FIELDS.billingState!,
  billingAmount: WORK_ORDER_FIELDS.billingAmount!,
  amountDrafted: WORK_ORDER_FIELDS.amountDrafted!,
  amountInvoiced: WORK_ORDER_FIELDS.amountInvoiced!,
  uninvoicedAmount: WORK_ORDER_FIELDS.uninvoicedAmount!,
  balanceDue: WORK_ORDER_FIELDS.balanceDue!,
  invoiceCount: WORK_ORDER_FIELDS.invoiceCount!,
  nextInvoiceDate: WORK_ORDER_FIELDS.nextInvoiceDate!,
  billingRevision: WORK_ORDER_FIELDS.billingRevision!,
}

const INVOICE_PROJECTIONS = {
  billingKind: INVOICE_FIELDS.billingKind!,
  servicePeriodStart: INVOICE_FIELDS.servicePeriodStart!,
  servicePeriodEnd: INVOICE_FIELDS.servicePeriodEnd!,
  visitCount: INVOICE_FIELDS.visitCount!,
  progressPercent: INVOICE_FIELDS.progressPercent!,
  installmentName: INVOICE_FIELDS.installmentName!,
}

const CONTACT_PROJECTIONS = {
  balanceDue: CONTACT_FIELDS.balanceDue!,
  uninvoicedAmount: CONTACT_FIELDS.uninvoicedAmount!,
  billingRevision: CONTACT_FIELDS.billingRevision!,
}

/**
 * Clean-cutover entity definitions for allocation-backed work-order billing.
 * Allocation rows are physical tables; these fields are read-only UI/workflow projections.
 */
export const migration043WorkOrderBillingAllocations: EntityMigration = {
  id: '043-work-order-billing-allocations',
  description: 'Add allocation-backed work-order billing projection fields',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)
    let changed = false

    const workOrderDef = existing.entityDefs.get('work_order')
    const invoiceDef = existing.entityDefs.get('invoice')
    const contactDef = existing.entityDefs.get('contact')
    const lineItemDef = existing.entityDefs.get('line_item')

    if (workOrderDef) {
      await ensureCustomFields(
        db,
        organizationId,
        'work_order',
        workOrderDef.id,
        WORK_ORDER_PROJECTIONS,
        existing,
        state
      )

      const pricingField = existing.fields.get(
        fieldKey(workOrderDef.id, 'work_order_pricing_model')
      )
      if (pricingField) {
        const field = WORK_ORDER_FIELDS.pricingModel!
        const updated = await db
          .update(schema.CustomField)
          .set({
            name: field.label,
            description: field.description,
            options: buildFieldOptions(field),
            ...mapCapabilities(field.capabilities),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.CustomField.id, pricingField.id),
              or(
                ne(schema.CustomField.name, field.label),
                ne(schema.CustomField.description, field.description ?? ''),
                ne(schema.CustomField.options, buildFieldOptions(field))
              )
            )
          )
          .returning({ id: schema.CustomField.id })
        changed ||= updated.length > 0
      }

      const timingField = existing.fields.get(
        fieldKey(workOrderDef.id, 'work_order_invoice_timing')
      )
      if (timingField) {
        const field = WORK_ORDER_FIELDS.invoiceTiming!
        const updated = await db
          .update(schema.CustomField)
          .set({
            description: field.description,
            options: buildFieldOptions(field),
            ...mapCapabilities(field.capabilities),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.CustomField.id, timingField.id),
              or(
                ne(schema.CustomField.description, field.description ?? ''),
                ne(schema.CustomField.options, buildFieldOptions(field))
              )
            )
          )
          .returning({ id: schema.CustomField.id })
        changed ||= updated.length > 0
      }
    }

    if (invoiceDef) {
      await ensureCustomFields(
        db,
        organizationId,
        'invoice',
        invoiceDef.id,
        INVOICE_PROJECTIONS,
        existing,
        state
      )
    }

    if (contactDef) {
      await ensureCustomFields(
        db,
        organizationId,
        'contact',
        contactDef.id,
        CONTACT_PROJECTIONS,
        existing,
        state
      )
    }

    if (lineItemDef) {
      const invoiceField = existing.fields.get(fieldKey(lineItemDef.id, 'line_item_invoice'))
      if (invoiceField) {
        const updated = await db
          .update(schema.CustomField)
          .set({
            description: LINE_ITEM_FIELDS.invoice!.description,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.CustomField.id, invoiceField.id),
              ne(schema.CustomField.description, LINE_ITEM_FIELDS.invoice!.description ?? '')
            )
          )
          .returning({ id: schema.CustomField.id })
        changed ||= updated.length > 0
      }
    }

    for (const [def, attribute] of [
      [invoiceDef, 'invoice_visit_id'],
      [lineItemDef, 'line_item_source_line_id'],
    ] as const) {
      if (!def) continue
      const obsolete = existing.fields.get(fieldKey(def.id, attribute))
      if (!obsolete) continue

      await db
        .delete(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, obsolete.id)
          )
        )
      await db.delete(schema.CustomField).where(eq(schema.CustomField.id, obsolete.id))
      changed = true
    }

    const alreadyUpToDate = state.fieldsCreated === 0 && !changed
    if (!alreadyUpToDate) logger.info('Migration 043 applied', { organizationId, ...state })
    return { ...state, alreadyUpToDate }
  },
}
