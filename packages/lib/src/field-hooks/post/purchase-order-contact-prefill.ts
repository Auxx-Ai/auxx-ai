// packages/lib/src/field-hooks/post/purchase-order-contact-prefill.ts

import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'
import { getOrgCache } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { FieldValueService } from '../../field-values/field-value-service'
import { toFieldType } from '../../field-values/stored-field-type'
import { resolveCompanyPrimaryContact } from '../../resources/hooks/purchasing-hooks'
import type { EntityFieldChangeHandler } from '../types'

const logger = createScopedLogger('field-hooks:purchase-order-contact-prefill')

/**
 * Read a `RecordId` out of a post-write relationship value. RELATIONSHIP fields
 * report the FULL array the write produced, and `null` when the write cleared the
 * only row.
 */
function readRelationshipRecordId(raw: unknown): RecordId | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value === 'string') return value as RecordId
  const typed = value as TypedFieldValue | undefined
  if (typed?.type === 'relationship' && typed.recordId) return typed.recordId
  return null
}

/**
 * Default `purchase_order_contact` from the vendor's `company_primary_contact`
 * (purchasing plan 07; the intent was recorded on the field itself in
 * `purchase-order-fields.ts` and shipped without a writer).
 *
 * ⚠️ **This is the SECOND door, and it is the one the UI actually uses.** The
 * `purchase_order_vendor` system hook in `resources/hooks/purchasing-hooks.ts`
 * covers writes through `UnifiedCrudHandler` (`record.create`, the importer, the
 * SDK) — that is how an order is first drafted against a supplier. But every EDIT
 * to an existing order goes through `useSaveFieldValue` -> `fieldValue.set` ->
 * `FieldValueService`, which consults only `getFieldPreHooks` /
 * `getEntityFieldChangeHooks` and never reads the system-hook registry at all.
 * Re-pointing an order at a different supplier reaches ONLY this handler. The same
 * split is recorded on `line-item-part-stamp.ts` and on the two
 * `purchase_order_status` guards.
 *
 * ⚠️ **Registered under `purchase_order_vendor`, not `purchase_order_contact`.**
 * `runPreHooks` skips a system hook on UPDATE unless its own registered
 * systemAttribute is present in `values`, so the twin keyed on the contact would
 * fire on create only. Both doors are keyed on the vendor so the two stay
 * symmetrical.
 *
 * ## This is a PREFILL, not a stamp
 *
 * `line_item_part` is a provenance STAMP and always overwrites. A contact is a
 * person somebody chose, so the rule is narrower — **replace our own prefill,
 * never a human's pick**:
 *
 * - no contact yet -> fill from the new vendor
 * - the contact equals the OLD vendor's primary contact -> it was this hook's own
 *   prefill, so re-derive it from the new vendor
 * - anything else -> a human picked that person; leave it alone
 *
 * `oldValue` is what makes that test cheap: the alternative is reading the
 * contact's `contact_employer` / `contact_company`, which are two DIFFERENT edges
 * (`company_primary_contact` inverts to `contact:company`, `company_employees` to
 * `contact:employer`) and answer a subtly different question.
 *
 * When the new vendor has no primary contact, a prefilled contact is CLEARED
 * rather than left: it names a person at the previous supplier, and this field's
 * only consumer is the address line on an email to the new one.
 *
 * `undefined` from the resolver means "could not resolve" and always leaves the
 * field untouched — collapsing it into `null` would clear a good contact on a
 * transient failure.
 *
 * No recursion: this fires only for `purchase_order_vendor` and writes only
 * `purchase_order_contact`.
 */
export const prefillContactOnVendorChange: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'purchase_order_vendor') return

  const { organizationId, userId, recordId } = event

  try {
    const cf = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['purchase_order_contact'] as const)
    const contactField = cf.purchase_order_contact
    if (!contactField) return

    const newVendor = readRelationshipRecordId(event.newValue)
    // Detaching the vendor is not a re-point. Whoever the order is addressed to is
    // still the last thing anybody decided, and there is no new supplier to derive
    // a better answer from.
    if (!newVendor) return

    const next = await resolveCompanyPrimaryContact({
      organizationId,
      userId,
      companyRecordId: newVendor,
    })
    if (next === undefined) return

    const values = await new FieldValueService(organizationId, userId).getValues({
      recordId,
      fieldIds: [contactField.id],
    })
    const entry = values.get(contactField.id)
    const typed: TypedFieldValue | undefined = Array.isArray(entry) ? entry[0] : entry
    const current = typed?.type === 'relationship' ? (typed.recordId ?? null) : null

    if (current) {
      const oldVendor = readRelationshipRecordId(event.oldValue)
      if (!oldVendor) return

      const prior = await resolveCompanyPrimaryContact({
        organizationId,
        userId,
        companyRecordId: oldVendor,
      })
      // `undefined` here is the dangerous one: it cannot tell a human's pick from
      // this hook's own prefill, and guessing wrong discards a deliberate choice.
      if (prior === undefined || prior !== current) return
    }

    if (current === next) return

    const ctx = await createFieldValueContext(organizationId, userId)
    await setValueWithType(ctx, {
      recordId,
      fieldId: contactField.id,
      fieldType: toFieldType(contactField.type),
      value: next ? { type: 'relationship', recordId: next } : null,
    })
  } catch (error) {
    // A default must never fail the vendor write it rides on.
    logger.warn('could not prefill purchase_order_contact from the vendor', {
      organizationId,
      recordId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
