// packages/lib/src/accounting/banking/__tests__/support/field-stubs.ts

/**
 * A `CustomField` stand-in for the banking tests' org-cache doubles.
 *
 * The field's TYPE is what `readSystemRecords` converts a stored row through, so
 * a stub without one reads every cell as unset. Taken from the registry rather
 * than re-listed, so a field that changes type cannot silently pass here.
 */

import { BANK_ACCOUNT_FIELDS } from '../../../../resources/registry/resources/bank-account-fields'
import { BANK_RULE_FIELDS } from '../../../../resources/registry/resources/bank-rule-fields'
import { BANK_TRANSACTION_FIELDS } from '../../../../resources/registry/resources/bank-transaction-fields'

const REGISTRY = [BANK_ACCOUNT_FIELDS, BANK_RULE_FIELDS, BANK_TRANSACTION_FIELDS]

/** The registry's field type for one system attribute; an unknown one throws rather than reading as TEXT and passing silently. */
export function fieldTypeOf(attribute: string): string {
  for (const map of REGISTRY) {
    for (const field of Object.values(map)) {
      if (field?.systemAttribute === attribute) return field.fieldType ?? 'TEXT'
    }
  }
  throw new Error(`[field-stubs] No banking registry field declares ${attribute}`)
}

/** `{ id, type }` for every attribute asked for; the id IS the attribute, so a predicate reads legibly. */
export function fieldStubs(attributes: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    attributes.map((attribute) => [attribute, { id: attribute, type: fieldTypeOf(attribute) }])
  )
}
