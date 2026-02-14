// packages/lib/src/import/fields/get-importable-fields.ts

import {
  getRelatedEntityDefinitionId,
  type RelationshipConfig,
  type SelectOption,
} from '@auxx/types/custom-field'
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
    relatedEntityDefinitionId: string
    relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
    /** Target resource for relationship resolution during import */
    targetResource?: {
      displayField?: string // Field to match by (e.g., 'name')
      identifierField?: string // Usually 'id'
    }
  }
  options?: SelectOption[]
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
    .map((field) => {
      // Custom fields have UUID id different from key; system fields have id === key
      const isCustomField = !field.isSystem && field.id !== field.key
      return {
        key: field.key,
        id: isCustomField ? field.id : undefined,
        label: field.label,
        type: field.type,
        required: field.capabilities.required,
        isRelation: false,
        isIdentifier: false,
        group: (isCustomField ? 'custom' : 'system') as FieldGroup,
        options: field.options?.options,
      }
    })
  fields.push(...scalarFields)

  // 3. Add relationship fields if requested
  if (includeRelationships) {
    const relationFields = resource.fields
      .filter((field) => field.capabilities.creatable && field.relationship)
      .map((field) => {
        const isCustomField = !field.isSystem && field.id !== field.key
        return {
          key: field.key,
          id: isCustomField ? field.id : undefined,
          label: field.label,
          type: field.type,
          required: field.capabilities.required,
          isRelation: true,
          isIdentifier: false,
          group: 'relationship' as FieldGroup,
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
    .filter((field) => field.capabilities.required && field.capabilities.creatable)
    .map((field) => field.key)
}
