// packages/lib/src/data-migrations/migrations/167-document-attachments.ts

import { schema } from '@auxx/database'
import { and, eq, ne, or } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { BANK_DEPOSIT_FIELDS } from '../../resources/registry/resources/bank-deposit-fields'
import { CREDIT_MEMO_FIELDS } from '../../resources/registry/resources/credit-memo-fields'
import { INVOICE_FIELDS } from '../../resources/registry/resources/invoice-fields'
import { PURCHASE_ORDER_FIELDS } from '../../resources/registry/resources/purchase-order-fields'
import { QUOTE_FIELDS } from '../../resources/registry/resources/quote-fields'
import { VENDOR_BILL_FIELDS } from '../../resources/registry/resources/vendor-bill-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration } from '../per-org'

/** A new or retyped field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/** The four defs that had no attachments field at all — these get an INSERT. */
const NEW = [
  ['quote', QUOTE_FIELDS.attachments],
  ['invoice', INVOICE_FIELDS.attachments],
  ['credit_memo', CREDIT_MEMO_FIELDS.attachments],
  ['bank_deposit', BANK_DEPOSIT_FIELDS.attachments],
] as const

/** Every attachments field, new and pre-existing — these all get the UPDATE below. */
const ALL = [
  ...NEW,
  ['purchase_order', PURCHASE_ORDER_FIELDS.attachments],
  ['vendor_bill', VENDOR_BILL_FIELDS.attachments],
] as const

/**
 * Migration 167: every document def carries an `attachments` field, and every one of them is
 * hidden from the dialogs and the field list — the documents card is their only door.
 *
 * ## Two halves, and the second is not optional
 *
 * `ensureCustomFields` is INSERT-only: it skips a def that already holds the attribute and
 * never UPDATEs a stored field. So the four new fields land from the registry, but
 * `purchase_order_attachments` and `vendor_bill_attachments` — which have existed in every
 * org since August — would keep `isHidden: false` forever, in production as much as in dev.
 * `CustomField.isHidden` is the column `resource-registry-service.ts` reads back as
 * `capabilities.hidden`, so without the UPDATE the registry edit reaches nobody.
 *
 * `showInDialogs` needs no such treatment: it is served straight off the static registry and
 * has no column.
 *
 * The UPDATE also corrects `sortOrder`, which matters for exactly one field — `invoice`'s,
 * first inserted at 'aK1' where it collided with `creditMemos`, now 'aK0'. Both halves are
 * idempotent and guarded so a converged org writes nothing.
 */
export const migration167DocumentAttachments: PerOrgMigration = {
  id: '167-document-attachments',
  description: 'Adds the attachments field to four document defs and hides all six from the UI.',
  async up(db, organizationId) {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    for (const [entityType, field] of NEW) {
      if (!field) throw new Error(`${entityType} registry is missing its attachments field`)
      const def = existing.entityDefs.get(entityType)
      if (!def) continue
      await ensureCustomFields(
        db,
        organizationId,
        entityType,
        def.id,
        { attachments: field },
        existing,
        state
      )
    }

    let updated = 0
    for (const [entityType, field] of ALL) {
      if (!field?.systemAttribute) throw new Error(`${entityType} attachments field is malformed`)
      const sortOrder = field.systemSortOrder ?? 'a0'
      const rows = await db
        .update(schema.CustomField)
        .set({ isHidden: true, sortOrder, updatedAt: new Date() })
        .where(
          and(
            eq(schema.CustomField.organizationId, organizationId),
            eq(schema.CustomField.systemAttribute, field.systemAttribute),
            // Converged rows write nothing, so a re-run is free.
            or(eq(schema.CustomField.isHidden, false), ne(schema.CustomField.sortOrder, sortOrder))
          )
        )
        .returning({ id: schema.CustomField.id })
      updated += rows.length
    }

    const changed = state.fieldsCreated > 0 || updated > 0
    if (changed) await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
    return { ...state, alreadyUpToDate: !changed }
  },
}
