// packages/lib/src/import/fields/get-importable-fields.ts

import type { Resource } from '../../resources/registry/types'
import { getIdentifiableFields } from './get-identifiable-fields'

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
  group: FieldGroup
  relationConfig?: {
    targetTable: string
    cardinality: 'one-to-many' | 'many-to-one'
    /** Target resource for relationship resolution during import */
    targetResource?: {
      displayField?: string // Field to match by (e.g., 'name')
      identifierField?: string // Usually 'id'
    }
  }
  enumValues?: Array<{ dbValue: string; label: string }>
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

  // 1. Add identifier fields if requested
  if (includeIdentifiers) {
    const identifierFields = getIdentifiableFields(resource)
    fields.push(...identifierFields)
  }

  // 2. Add creatable scalar fields
  const scalarFields = resource.fields
    .filter((field) => field.capabilities.creatable && !field.relationship)
    .map((field) => ({
      key: field.key,
      id: field.id,
      label: field.label,
      type: field.type,
      required: field.capabilities.required,
      isRelation: false,
      isIdentifier: false,
      group: (field.id ? 'custom' : 'system') as FieldGroup,
      enumValues: field.enumValues,
    }))
  fields.push(...scalarFields)

  // 3. Add relationship fields if requested
  if (includeRelationships) {
    const relationFields = resource.fields
      .filter((field) => field.capabilities.creatable && field.relationship)
      .map((field) => ({
        key: field.key,
        id: field.id,
        label: field.label,
        type: field.type,
        required: field.capabilities.required,
        isRelation: true,
        isIdentifier: false,
        group: 'relationship' as FieldGroup,
        relationConfig: {
          targetTable: field.relationship!.relatedEntityDefinitionId,
          relationshipType: field.relationship!.relationshipType,
        },
      }))
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
    .filter((field) => field.capabilities.required && field.capabilities.creatable)
    .map((field) => field.key)
}
