// packages/lib/src/import/fields/get-importable-fields.ts

import {
  getRelatedEntityDefinitionId,
  type RelationshipConfig,
  type SelectOption,
} from '@auxx/types/custom-field'
import { getFieldOutputKey } from '../../resources/registry/field-types'
import type { Resource } from '../../resources/registry/types'
import { getIdentifiableFields } from './get-identifiable-fields'
import { getIdentifierEligibility, type IdentifierTier } from './identifier-eligibility'

/** Field group type for organizing fields in the UI */
export type FieldGroup = 'identifier' | 'system' | 'custom' | 'relationship'

/** Importable field with additional metadata */
export interface ImportableField {
  key: string
  id?: string // Custom field ID for entity fields
  label: string
  type: string
  required: boolean
  isRelation: boolean
  isIdentifier: boolean
  /** True for multi-value scalar fields (`options.multi`) — values append to the existing list */
  multi?: boolean
  group: FieldGroup
  relationConfig?: {
    relatedEntityDefinitionId: string
    relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
    /** Target resource for relationship resolution during import */
    targetResource?: {
      displayField?: string // Field to match by (e.g., 'name')
      identifierField?: string // Usually 'id'
    }
  }
  options?: SelectOption[]
  /**
   * Present ⇔ this field may be flagged as an identifier as (part of) the import match key.
   * `1` = Recommended, `2` = Available. Absent = never offer the toggle.
   *
   * Independent of `group`. `group: 'identifier'` is the picker HEADING and
   * carries tier-1 fields only, promoting every eligible tier-2 string into
   * that heading would file most of a resource's fields under "Identifier".
   * A tier-2 field keeps its natural group and still carries this tier.
   */
  identifierTier?: IdentifierTier
  /** `true` for RELATION fields: usable only inside a COMPOSITE key, never alone. */
  identifierCompositeOnly?: boolean
  /** Inline caveat the picker renders next to a tier-2 field. */
  identifierNote?: string
}

/** Options for getImportableFields */
export interface GetImportableFieldsOptions {
  /** Include identifier fields (id, externalId) for update operations */
  includeIdentifiers?: boolean
  /** Include relationship fields for linking to other resources */
  includeRelationships?: boolean
}

/**
 * Get fields that can be imported for a resource.
 * Filters out fields that aren't creatable unless they are identifiers.
 *
 * @param resource - Resource definition
 * @param options - Options to customize which fields are included
 * @returns Array of importable fields
 */
export function getImportableFields(
  resource: Resource,
  options: GetImportableFieldsOptions = {}
): ImportableField[] {
  const { includeIdentifiers = false, includeRelationships = true } = options
  const fields: ImportableField[] = []

  // 1. Add identifier fields if requested.
  //
  // Only TIER 1 goes into the `identifier` GROUP. `getIdentifiableFields` now
  // grades rather than restricts, so it also returns every eligible non-unique
  // string, url, number…, filing all of those under the picker's "Identifier"
  // heading would move most of a resource's fields out of System/Custom. Tier-2
  // fields stay in their natural group and carry `identifierTier: 2` instead,
  // which is what the identity toggle actually reads.
  //
  // Composite-only (RELATION) entries are excluded from the group too. They
  // stay in the `relationship` group, which does NOT dedupe against this pass,
  // so promoting one here would list it under two headings, the exact duplicate
  // #1788 removed for scalars.
  if (includeIdentifiers) {
    fields.push(
      ...getIdentifiableFields(resource).filter(
        (f) => f.identifierTier === 1 && !f.identifierCompositeOnly
      )
    )
  }

  // 2. Add creatable scalar fields (excluding hidden system fields).
  //
  // Keys already emitted by the identifier pass are skipped: an identifier is
  // usually creatable too (SKU, Ticket #, Email), so without this the same key
  // is pushed twice — once as `group: 'identifier'` and once as
  // `'system'`/`'custom'` — and the picker lists it under both headings. The
  // identifier entry wins because it carries `isIdentifier`, which is what the
  // picker groups on and what the identifier selector reads.
  const emittedKeys = new Set(fields.map((f) => f.key))
  const scalarFields = resource.fields
    .filter(
      (field) => field.capabilities.creatable && !field.capabilities.hidden && !field.relationship
    )
    .filter((field) => !emittedKeys.has(getFieldOutputKey(field)))
    .map((field) => {
      const isCustomField = !field.isSystem
      const eligibility = getIdentifierEligibility(field)
      return {
        key: getFieldOutputKey(field),
        id: isCustomField ? field.id : undefined,
        label: field.label,
        type: field.type,
        required: field.capabilities.required ?? false,
        isRelation: false,
        isIdentifier: false,
        multi: field.options?.multi === true,
        group: (isCustomField ? 'custom' : 'system') as FieldGroup,
        options: field.options?.options,
        identifierTier: eligibility?.tier,
        identifierCompositeOnly: eligibility?.compositeOnly,
        identifierNote: eligibility?.note,
      }
    })
  fields.push(...scalarFields)

  // 3. Add relationship fields if requested (excluding hidden system fields)
  if (includeRelationships) {
    const relationFields = resource.fields
      .filter(
        (field) => field.capabilities.creatable && !field.capabilities.hidden && field.relationship
      )
      .map((field) => {
        const isCustomField = !field.isSystem
        const eligibility = getIdentifierEligibility(field)
        return {
          key: getFieldOutputKey(field),
          id: isCustomField ? field.id : undefined,
          label: field.label,
          type: field.type,
          required: field.capabilities.required ?? false,
          isRelation: true,
          isIdentifier: false,
          group: 'relationship' as FieldGroup,
          identifierTier: eligibility?.tier,
          identifierCompositeOnly: eligibility?.compositeOnly,
          identifierNote: eligibility?.note,
          relationConfig: {
            relatedEntityDefinitionId:
              getRelatedEntityDefinitionId(field.relationship as RelationshipConfig) ?? '',
            relationshipType: field.relationship!.relationshipType,
          },
        }
      })
    fields.push(...relationFields)
  }

  return fields
}

/**
 * Get required fields for a resource.
 *
 * @param resource - Resource definition
 * @returns Array of required field keys
 */
export function getRequiredFields(resource: Resource): string[] {
  return resource.fields
    .filter(
      (field) =>
        field.capabilities.required && field.capabilities.creatable && !field.capabilities.hidden
    )
    .map((field) => getFieldOutputKey(field))
}
