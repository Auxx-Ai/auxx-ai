// packages/lib/src/import/fields/get-identifiable-fields.ts

import { getFieldOutputKey } from '../../resources/registry/field-types'
import type { Resource } from '../../resources/registry/types'
import type { ImportableField } from './get-importable-fields'
import { getIdentifierEligibility, sortByIdentifierPreference } from './identifier-eligibility'

/**
 * Every field this resource may use as an import match key, graded.
 *
 * This is the single authority: `getImportableFields` reads it for the identity
 * toggle's eligibility metadata, and `registry/field-utils`'
 * `getIdentifierFields` / `getDefaultIdentifierField` delegate to it. Before
 * that delegation those two were a parallel `f.isIdentifier` filter, so the
 * picker and the planner's auto-select could silently disagree about what
 * counts as an identifier.
 *
 * Graded, not restricted. A non-unique field is still offered (tier 2, with
 * a note) because `(part, supplier)` on `vendor_part` is two non-unique
 * relations and is the correct identity, and because a picker that refuses to
 * offer a usable key fails open into create-only duplicate production, which is
 * the exact defect this whole area exists to fix.
 *
 * @param resource - Resource definition
 * @returns Eligible identifier fields, tier 1 first, Record ID last within tier 1
 */
export function getIdentifiableFields(resource: Resource): ImportableField[] {
  const entries: ImportableField[] = []

  for (const field of resource.fields) {
    const eligibility = getIdentifierEligibility(field)
    if (!eligibility) continue

    const isCustomField = !field.isSystem
    const outputKey = getFieldOutputKey(field)

    entries.push({
      key: outputKey,
      id: isCustomField ? field.id : undefined,
      label: outputKey === 'id' ? 'Record ID' : field.label,
      type: field.type,
      // `required` and `options` ride along because a field can be BOTH an
      // identifier and an ordinary mapping target (a required SKU, a select).
      // `getImportableFields` emits one entry per key and keeps this one, so
      // anything omitted here is lost rather than picked up by the scalar
      // pass, as `required: false` and a missing option list used to be.
      required: field.capabilities.required ?? false,
      isRelation: !!field.relationship,
      isIdentifier: true,
      multi: !field.relationship && field.options?.multi === true,
      group: 'identifier' as const,
      options: field.options?.options,
      identifierTier: eligibility.tier,
      identifierCompositeOnly: eligibility.compositeOnly,
      identifierNote: eligibility.note,
    })
  }

  return sortByIdentifierPreference(entries, (entry) => ({
    key: entry.key,
    tier: entry.identifierTier ?? 2,
  }))
}
