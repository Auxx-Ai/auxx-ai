// packages/lib/src/accounting/money/payouts/__tests__/support/field-stubs.ts

/**
 * A `CustomField` stand-in for the payout tests' org-cache doubles.
 *
 * The field's TYPE is what `readSystemRecords` converts a stored row through, so
 * a stub without one reads every cell as unset. Taken from the registry rather
 * than re-listed, so a field that changes type cannot silently pass here.
 */

import { BANK_ACCOUNT_FIELDS } from '../../../../../resources/registry/resources/bank-account-fields'
import { PAYOUT_FIELDS } from '../../../../../resources/registry/resources/payout-fields'

const REGISTRY = [PAYOUT_FIELDS, BANK_ACCOUNT_FIELDS]

/** The registry's field type for one system attribute; an unknown one throws rather than reading as TEXT and passing silently. */
export function fieldTypeOf(attribute: string): string {
  for (const map of REGISTRY) {
    for (const field of Object.values(map)) {
      if (field?.systemAttribute === attribute) return field.fieldType ?? 'TEXT'
    }
  }
  throw new Error(`[field-stubs] No payout registry field declares ${attribute}`)
}

/** `{ id, type }` per attribute, given the field id each stubbed attribute should carry. */
export function fieldStubs(ids: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(ids).map(([attribute, id]) => [attribute, { id, type: fieldTypeOf(attribute) }])
  )
}
