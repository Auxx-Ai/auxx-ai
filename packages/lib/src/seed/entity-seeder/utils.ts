// packages/lib/src/seed/entity-seeder/utils.ts

import type { ResourceField, FieldCapabilities } from '../../resources/registry/field-types'
import type { FieldType } from '@auxx/database/types'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import { fieldTypeDisplayDefaults, type FieldOptions } from '../../custom-fields'

/**
 * Build options object for CustomField from field definition
 * Merges default options for the field type with field-specific options
 */
export function buildFieldOptions(field: ResourceField): FieldOptions {
  const fieldType = field.fieldType as FieldType

  // Start with base options
  const options: FieldOptions = {
    icon: field.icon,
    isCustom: false, // System fields
  }

  // Merge default options for this field type
  const defaults = fieldTypeDisplayDefaults[fieldType] ?? {}
  Object.assign(options, defaults)

  // Merge field-specific options (from field definition)
  if (field.options) {
    // For SELECT types, copy the options array
    if (field.options.options) {
      options.options = field.options.options
    }
    // For other field options, merge them (excluding select options to avoid duplication)
    const { options: selectOptions, ...otherOptions } = field.options
    Object.assign(options, otherOptions)
  }

  // Handle RELATIONSHIP fields - use unified relationship structure
  if (fieldType === FieldTypeEnum.RELATIONSHIP && field.relationship) {
    options.relationship = {
      inverseResourceFieldId: null, // Static ref resolved in Pass 3
      relationshipType: field.relationship.relationshipType,
      isInverse: field.relationship.isInverse ?? false,
      // Include constraints if defined (for self-referential validation)
      constraints: field.relationship.constraints,
    }
  }

  // Handle ACTOR fields - copy actor options from field definition
  if (fieldType === FieldTypeEnum.ACTOR && field.options?.actor) {
    options.actor = field.options.actor
  }

  return options
}

/**
 * Map FieldCapabilities to CustomField columns
 *
 * FieldCapabilities (from field-types.ts):
 *   filterable, sortable, creatable, updatable, configurable, required, unique, computed
 *
 * CustomField columns:
 *   required, isUnique, isCreatable, isUpdatable, isComputed, isSortable, isFilterable
 *
 * Note: `configurable` has no column - derived from !systemAttribute at runtime
 */
export function mapCapabilities(capabilities?: FieldCapabilities) {
  return {
    required: capabilities?.required ?? false,
    isUnique: capabilities?.unique ?? false,
    isCreatable: capabilities?.creatable ?? true,
    isUpdatable: capabilities?.updatable ?? true,
    isComputed: capabilities?.computed ?? false,
    isSortable: capabilities?.sortable ?? true,
    isFilterable: capabilities?.filterable ?? true,
  }
}

/**
 * Check if a field should be created as a CustomField
 * Skips EntityInstance columns (id, created_at, updated_at)
 */
export function shouldCreateField(
  field: ResourceField,
  entityInstanceColumns: readonly string[]
): boolean {
  return Boolean(
    field.systemAttribute && !entityInstanceColumns.includes(field.systemAttribute)
  )
}
