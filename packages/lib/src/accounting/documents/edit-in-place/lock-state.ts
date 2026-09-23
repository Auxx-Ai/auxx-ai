// packages/lib/src/accounting/documents/edit-in-place/lock-state.ts
//
// The lock state of the families with no ledger of their own (66 U5/U7). Kept
// free of the ledger graph: the field pre-hooks import it.

import { type Database, schema } from '@auxx/database'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { isRecordConnectorManaged } from '../../../data-connectors/managed-fields'

/** The families whose lock is `field-hooks/pre/document-edit-lock.ts`. */
export type LockedDocumentFamily = 'quote' | 'purchase_order' | 'order'

/**
 * What an order's lock reads. An order has no draft, so its state is derived:
 * `open` until something ships, `synced` while a connector owns it.
 */
export const ORDER_LOCK_STATES = ['open', 'shipped', 'synced', 'cancelled'] as const

export interface DocumentLockState {
  /** The lifecycle value, or for an order one of {@link ORDER_LOCK_STATES}. */
  status: string
  /** The document number; empty when it has none. */
  label: string
}

/** The statuses a person edits freely, without opening an edit. */
export const DOCUMENT_OPEN_STATUSES: Readonly<Record<LockedDocumentFamily, readonly string[]>> = {
  quote: ['draft'],
  purchase_order: ['draft'],
  order: ['open'],
}

/**
 * The statuses Edit refuses: the open ones, which need no edit, and the ones
 * past amending. An approved quote waits on 65 Q2 (reapproval); a synced order
 * on 65 Q13, answered as a refusal.
 */
export const DOCUMENT_EDIT_REFUSED_IN: Readonly<Record<LockedDocumentFamily, readonly string[]>> = {
  quote: ['draft', 'approved', 'declined', 'canceled'],
  purchase_order: ['draft', 'closed', 'canceled'],
  order: ['open', 'synced', 'cancelled'],
}

const STATUS_ATTR = {
  quote: 'quote_status',
  purchase_order: 'purchase_order_status',
  order: 'order_fulfillment_status',
} as const satisfies Record<LockedDocumentFamily, SystemAttribute>

const NUMBER_ATTR = {
  quote: 'quote_number',
  purchase_order: 'purchase_order_number',
  order: 'order_number',
} as const satisfies Record<LockedDocumentFamily, SystemAttribute>

/** Fulfillment values that leave an order open: nothing has shipped against it. */
const UNSHIPPED = new Set(['unfulfilled'])

/** The document's lock state, or `null` when the record has no readable status. */
export async function readDocumentLockState(
  db: Database,
  organizationId: string,
  family: LockedDocumentFamily,
  entityInstanceId: string
): Promise<DocumentLockState | null> {
  const attrs: SystemAttribute[] = [STATUS_ATTR[family], NUMBER_ATTR[family]]
  if (family === 'order') attrs.push('order_cancelled_at')
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>(attrs)

  const fieldIds = attrs.map((attr) => fields[attr]?.id).filter((id): id is string => !!id)
  const rows =
    fieldIds.length === 0
      ? []
      : await db
          .select({
            fieldId: schema.FieldValue.fieldId,
            optionId: schema.FieldValue.optionId,
            valueText: schema.FieldValue.valueText,
            valueDate: schema.FieldValue.valueDate,
          })
          .from(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.organizationId, organizationId),
              eq(schema.FieldValue.entityId, entityInstanceId),
              inArray(schema.FieldValue.fieldId, fieldIds)
            )
          )
  const byField = new Map(rows.map((row) => [row.fieldId, row]))
  const read = (attr: SystemAttribute) => {
    const id = fields[attr]?.id
    return id ? byField.get(id) : undefined
  }
  const label = read(NUMBER_ATTR[family])?.valueText ?? ''

  if (family !== 'order') {
    const status = read(STATUS_ATTR[family])?.optionId
    return status ? { status, label } : null
  }

  // Connector first: a synced order is refused Edit whatever has shipped (65 Q13).
  if (await isRecordConnectorManaged(db, organizationId, entityInstanceId)) {
    return { status: 'synced', label }
  }
  if (read('order_cancelled_at')?.valueDate) return { status: 'cancelled', label }
  const fulfillment = read('order_fulfillment_status')?.optionId
  return { status: !fulfillment || UNSHIPPED.has(fulfillment) ? 'open' : 'shipped', label }
}
