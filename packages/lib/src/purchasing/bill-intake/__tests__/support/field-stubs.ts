// packages/lib/src/purchasing/bill-intake/__tests__/support/field-stubs.ts

/**
 * A `CustomField` stand-in for the bill-intake tests' org-cache doubles.
 *
 * The field's TYPE is what `readSystemRecords` converts a stored row through, so
 * a stub without one reads every cell as unset. Taken from the registry rather
 * than re-listed, so a field that changes type cannot silently pass here.
 */

import { PART_FIELDS } from '../../../../resources/registry/resources/part-fields'
import { PURCHASE_ORDER_LINE_FIELDS } from '../../../../resources/registry/resources/purchase-order-line-fields'
import { VENDOR_BILL_FIELDS } from '../../../../resources/registry/resources/vendor-bill-fields'
import { VENDOR_BILL_LINE_FIELDS } from '../../../../resources/registry/resources/vendor-bill-line-fields'
import { VENDOR_PART_FIELDS } from '../../../../resources/registry/resources/vendor-part-fields'

const REGISTRY = [
  VENDOR_BILL_FIELDS,
  VENDOR_BILL_LINE_FIELDS,
  PURCHASE_ORDER_LINE_FIELDS,
  PART_FIELDS,
  VENDOR_PART_FIELDS,
]

/** The registry's field type for one system attribute; an unknown one throws rather than passing as TEXT. */
export function fieldTypeOf(attribute: string): string {
  for (const map of REGISTRY) {
    for (const field of Object.values(map)) {
      if (field?.systemAttribute === attribute) return field.fieldType ?? 'TEXT'
    }
  }
  throw new Error(`[field-stubs] No purchasing registry field declares ${attribute}`)
}

/** `{ id, type }` for every materialised attribute asked for; the id is `fld_<attribute>`. */
export function fieldStubs(
  attributes: readonly string[],
  materialised: ReadonlySet<string>
): Record<string, unknown> {
  return Object.fromEntries(
    attributes.map((attribute) => [
      attribute,
      materialised.has(attribute) ? { id: `fld_${attribute}`, type: fieldTypeOf(attribute) } : null,
    ])
  )
}
