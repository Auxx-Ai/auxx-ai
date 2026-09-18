// packages/lib/src/accounting/money/bank-deposits/__tests__/support/field-stubs.ts

/**
 * A `CustomField` stand-in for this module's org-cache double.
 *
 * The field's TYPE is what `readSystemRecords` converts a stored row through, so
 * a stub without one reads every cell as unset. Taken from the registry rather
 * than re-listed, so a field that changes type cannot silently pass here.
 */

import { BANK_ACCOUNT_FIELDS } from '../../../../../resources/registry/resources/bank-account-fields'
import { BANK_DEPOSIT_FIELDS } from '../../../../../resources/registry/resources/bank-deposit-fields'

const REGISTRY = [BANK_DEPOSIT_FIELDS, BANK_ACCOUNT_FIELDS]

/** The registry's field type for one system attribute; an unknown one throws rather than reading as TEXT and passing silently. */
export function fieldTypeOf(attribute: string): string {
  for (const map of REGISTRY) {
    for (const field of Object.values(map)) {
      if (field?.systemAttribute === attribute) return field.fieldType ?? 'TEXT'
    }
  }
  throw new Error(`[field-stubs] No bank-deposit registry field declares ${attribute}`)
}

/** `{ id, type }` for every attribute asked for; the id is `fld_<attribute>`, so a stored row reads legibly. */
export function fieldStubs(attributes: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    attributes.map((attribute) => [
      attribute,
      { id: `fld_${attribute}`, type: fieldTypeOf(attribute) },
    ])
  )
}
