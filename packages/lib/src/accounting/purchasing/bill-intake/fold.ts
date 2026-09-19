// packages/lib/src/accounting/purchasing/bill-intake/fold.ts

import { type Database, schema } from '@auxx/database'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getCachedEntityDefId, getOrgCache } from '../../../cache'
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../../errors'
import { flushTxWriteScope } from '../../../resources/crud/tx-write-flush'
import { runInTxWrite } from '../../../resources/crud/tx-write-scope'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { guard } from './guard'

/** Move a printed line amount into an empty shipping field and remove the line atomically. */
export async function foldBillLineIntoShipping(
  db: Database,
  organizationId: string,
  userId: string,
  input: { billRecordId: RecordId; lineRecordId: RecordId }
) {
  return guard(
    async () => {
      const bill = parseRecordId(input.billRecordId)
      const line = parseRecordId(input.lineRecordId)
      const [billDefId, lineDefId, fields] = await Promise.all([
        getCachedEntityDefId(organizationId, 'vendor_bill'),
        getCachedEntityDefId(organizationId, 'vendor_bill_line'),
        getOrgCache()
          .from(organizationId, 'customFields')
          .bySystemAttributes([
            'vendor_bill_shipping_total',
            'vendor_bill_line_vendor_bill',
            'vendor_bill_line_purchase_order_line',
            'vendor_bill_line_line_total',
          ] as const),
      ])
      if (
        !billDefId ||
        !lineDefId ||
        ![billDefId, 'vendor_bill'].includes(bill.entityDefinitionId) ||
        ![lineDefId, 'vendor_bill_line'].includes(line.entityDefinitionId)
      ) {
        throw new UnprocessableEntityError('Choose a vendor bill and one of its lines')
      }
      const shippingField = fields.vendor_bill_shipping_total
      const parentField = fields.vendor_bill_line_vendor_bill
      const orderLineField = fields.vendor_bill_line_purchase_order_line
      const totalField = fields.vendor_bill_line_line_total
      if (!shippingField || !parentField || !orderLineField || !totalField) {
        throw new UnprocessableEntityError('The bill fields are not available')
      }

      const { result, scope, owned } = await db.transaction((tx) =>
        runInTxWrite({ organizationId, actorUserId: userId }, async () => {
          // Lock the parent first so concurrent folds cannot both fill empty shipping.
          const [billRow] = await tx
            .select({ id: schema.EntityInstance.id })
            .from(schema.EntityInstance)
            .where(
              and(
                eq(schema.EntityInstance.id, bill.entityInstanceId),
                eq(schema.EntityInstance.entityDefinitionId, billDefId),
                eq(schema.EntityInstance.organizationId, organizationId),
                isNull(schema.EntityInstance.archivedAt)
              )
            )
            .for('update')
          const [lineRow] = await tx
            .select({ id: schema.EntityInstance.id })
            .from(schema.EntityInstance)
            .where(
              and(
                eq(schema.EntityInstance.id, line.entityInstanceId),
                eq(schema.EntityInstance.entityDefinitionId, lineDefId),
                eq(schema.EntityInstance.organizationId, organizationId),
                isNull(schema.EntityInstance.archivedAt)
              )
            )
            .for('update')
          if (!billRow || !lineRow) throw new NotFoundError('Vendor bill or line not found')

          const cells = await tx
            .select({
              entityId: schema.FieldValue.entityId,
              fieldId: schema.FieldValue.fieldId,
              valueNumber: schema.FieldValue.valueNumber,
              relatedEntityId: schema.FieldValue.relatedEntityId,
            })
            .from(schema.FieldValue)
            .where(
              and(
                eq(schema.FieldValue.organizationId, organizationId),
                inArray(schema.FieldValue.entityId, [bill.entityInstanceId, line.entityInstanceId]),
                inArray(schema.FieldValue.fieldId, [
                  shippingField.id,
                  parentField.id,
                  orderLineField.id,
                  totalField.id,
                ])
              )
            )
          const cell = (entityId: string, fieldId: string) =>
            cells.find((row) => row.entityId === entityId && row.fieldId === fieldId)
          if (
            cell(line.entityInstanceId, parentField.id)?.relatedEntityId !== bill.entityInstanceId
          ) {
            throw new UnprocessableEntityError('This line does not belong to the bill')
          }
          if (cell(line.entityInstanceId, orderLineField.id)?.relatedEntityId) {
            throw new ConflictError('A line linked to an order cannot be moved into shipping')
          }
          const shipping = cell(bill.entityInstanceId, shippingField.id)?.valueNumber
          if (shipping != null && shipping !== 0) {
            throw new ConflictError('This bill already has a shipping amount')
          }
          const amount = cell(line.entityInstanceId, totalField.id)?.valueNumber
          if (amount == null || !Number.isSafeInteger(amount)) {
            throw new UnprocessableEntityError(
              'Enter the printed line total before moving it into shipping'
            )
          }
          const handler = new UnifiedCrudHandler(organizationId, userId, tx as unknown as Database)
          await handler.update(input.billRecordId, { vendor_bill_shipping_total: amount })
          // Generic edits can report success after a field guard drops a write.
          const [saved] = await tx
            .select({ valueNumber: schema.FieldValue.valueNumber })
            .from(schema.FieldValue)
            .where(
              and(
                eq(schema.FieldValue.organizationId, organizationId),
                eq(schema.FieldValue.entityId, bill.entityInstanceId),
                eq(schema.FieldValue.fieldId, shippingField.id)
              )
            )
          if (saved?.valueNumber !== amount) {
            throw new ConflictError('The shipping amount could not be saved; the line was kept')
          }
          await handler.delete(input.lineRecordId)
          return { shippingTotal: amount }
        })
      )
      if (owned) await flushTxWriteScope(scope)
      return result
    },
    'Failed to move a bill line into shipping',
    { organizationId, ...input }
  )
}
