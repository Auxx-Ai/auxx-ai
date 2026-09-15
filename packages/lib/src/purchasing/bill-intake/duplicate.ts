// packages/lib/src/purchasing/bill-intake/duplicate.ts

/**
 * The one refusal that reads the paper (plans/money/tasks/58 §4.2): the same
 * vendor's same invoice number, already on file as a `vendor_bill`.
 *
 * 🔑 A re-sent invoice is the classic duplicate-payment vector, and the one
 * door that reads the paper is the one place to catch it. `vendor_bill`
 * declares no natural key — `(vendor, number)` is not unique by design, so two
 * vendors may share a string and a person entering the same number twice by
 * hand still can (§0.4). This is a read, not a constraint: the manual path is
 * untouched.
 *
 * Values come off `FieldValue`'s own columns rather than through
 * `UnifiedCrudHandler.getFieldValues`, the trade `expense-bill/reads.ts`
 * documents at its own header — no actor is needed for a read.
 *
 * No permission checks. The router asserts and calls in.
 */

import { type Database, schema } from '@auxx/database'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { guard } from './guard'

/** The bill an invoice already exists as, when it does. */
export interface ExistingBill {
  billRecordId: RecordId
  internalNumber: string | null
  number: string
}

/**
 * Lowercase, trim, collapse internal whitespace to one space. Applied to BOTH
 * the printed number and the stored one, so "INV-88213" and " inv-88213 "
 * and "INV -  88213" are recognised as the same invoice.
 */
function foldInvoiceNumber(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Is this invoice already a bill from this vendor?
 *
 * One `FieldValue` read: every `vendor_bill` naming this vendor, joined to its
 * own printed number, with the fold applied in application code (a SQL `trim`
 * alone does not collapse internal whitespace). Soft-deleted instances are
 * excluded the way `expense-bill/reads.ts` excludes them.
 *
 * Returns the first match when several exist — `(vendor, number)` is not
 * unique (§0.4), and any one of them answers "yes, on file" for the refusal's
 * purpose.
 */
export async function findExistingBill(
  db: Database,
  organizationId: string,
  params: { vendorRecordId: RecordId; invoiceNumber: string }
): Promise<Result<ExistingBill | null, Error>> {
  return guard(
    async () => {
      const vendorBillDefId = await getCachedEntityDefId(organizationId, 'vendor_bill')
      if (!vendorBillDefId) return null

      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([
          'vendor_bill_vendor',
          'vendor_bill_number',
          'vendor_bill_internal_number',
        ] as const)

      const vendorField = fields.vendor_bill_vendor
      const numberField = fields.vendor_bill_number
      const internalField = fields.vendor_bill_internal_number
      if (!vendorField || !numberField) return null

      const { entityInstanceId: vendorInstanceId } = parseRecordId(params.vendorRecordId)

      const vendorValue = alias(schema.FieldValue, 'vb_vendor_value')
      const numberValue = alias(schema.FieldValue, 'vb_number_value')
      const internalValue = alias(schema.FieldValue, 'vb_internal_value')

      const rows = await db
        .select({
          billInstanceId: schema.EntityInstance.id,
          number: numberValue.valueText,
          internalNumber: internalValue.valueText,
        })
        .from(schema.EntityInstance)
        .innerJoin(
          vendorValue,
          and(
            eq(vendorValue.entityId, schema.EntityInstance.id),
            eq(vendorValue.organizationId, schema.EntityInstance.organizationId),
            eq(vendorValue.fieldId, vendorField.id),
            eq(vendorValue.relatedEntityId, vendorInstanceId)
          )
        )
        .innerJoin(
          numberValue,
          and(
            eq(numberValue.entityId, schema.EntityInstance.id),
            eq(numberValue.organizationId, schema.EntityInstance.organizationId),
            eq(numberValue.fieldId, numberField.id)
          )
        )
        .leftJoin(
          internalValue,
          and(
            eq(internalValue.entityId, schema.EntityInstance.id),
            eq(internalValue.organizationId, schema.EntityInstance.organizationId),
            eq(internalValue.fieldId, internalField?.id ?? '')
          )
        )
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, vendorBillDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .orderBy(schema.EntityInstance.id)

      const foldedInput = foldInvoiceNumber(params.invoiceNumber)
      const hit = rows.find((row) => row.number && foldInvoiceNumber(row.number) === foldedInput)
      if (!hit) return null

      return {
        billRecordId: toRecordId(vendorBillDefId, hit.billInstanceId),
        internalNumber: hit.internalNumber,
        number: hit.number ?? '',
      }
    },
    'Failed to check for an existing vendor bill',
    { organizationId, vendorRecordId: params.vendorRecordId }
  )
}
