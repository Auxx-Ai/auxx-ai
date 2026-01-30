// packages/lib/src/workflow-engine/utils/field-type-mapper.ts

import { BaseType } from '../types'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'

/**
 * Map database FieldType to BaseType for workflow operations
 * Used by workflow nodes (CRUD, Find, etc.) to convert custom field types
 * to the workflow type system.
 */
export function mapFieldTypeToBaseType(fieldType: FieldType | string): BaseType {
  switch (fieldType) {
    case FieldTypeEnum.TEXT:
    case FieldTypeEnum.NAME:
      return BaseType.STRING
    case FieldTypeEnum.RICH_TEXT:
      return BaseType.STRING
    case FieldTypeEnum.NUMBER:
      return BaseType.NUMBER
    case FieldTypeEnum.EMAIL:
      return BaseType.EMAIL
    case FieldTypeEnum.URL:
      return BaseType.URL
    case FieldTypeEnum.PHONE_INTL:
      return BaseType.PHONE
    case FieldTypeEnum.DATE:
      return BaseType.DATE
    case FieldTypeEnum.DATETIME:
      return BaseType.DATETIME
    case FieldTypeEnum.TIME:
      return BaseType.TIME
    case FieldTypeEnum.CHECKBOX:
      return BaseType.BOOLEAN
    case FieldTypeEnum.TAGS:
      return BaseType.TAGS
    case FieldTypeEnum.SINGLE_SELECT:
      return BaseType.ENUM
    case FieldTypeEnum.MULTI_SELECT:
      return BaseType.ARRAY // Array of selected values
    case FieldTypeEnum.ADDRESS:
      return BaseType.STRING // Free-text address
    case FieldTypeEnum.ADDRESS_STRUCT:
      return BaseType.ADDRESS
    case FieldTypeEnum.CURRENCY:
      return BaseType.CURRENCY
    case FieldTypeEnum.FILE:
      return BaseType.FILE
    case FieldTypeEnum.RELATIONSHIP:
      return BaseType.RELATION
    case FieldTypeEnum.ACTOR:
      return BaseType.ACTOR
    case FieldTypeEnum.JSON:
      return BaseType.JSON
    default:
      console.warn(`Unknown FieldType: ${fieldType}, defaulting to STRING`)
      return BaseType.STRING
  }
}

/**
 * Reverse map BaseType to preferred FieldType for frontend display
 * Used for icon selection, cell formatters, etc.
 *
 * Note: Some BaseTypes map to multiple FieldTypes (e.g., STRING → TEXT, NAME, RICH_TEXT).
 * This returns the most common/preferred FieldType for display purposes.
 */
export function mapBaseTypeToFieldType(baseType: BaseType): FieldType {
  switch (baseType) {
    case BaseType.STRING:
      return FieldTypeEnum.TEXT
    case BaseType.NUMBER:
      return FieldTypeEnum.NUMBER
    case BaseType.EMAIL:
      return FieldTypeEnum.EMAIL
    case BaseType.URL:
      return FieldTypeEnum.URL
    case BaseType.PHONE:
      return FieldTypeEnum.PHONE_INTL
    case BaseType.DATE:
      return FieldTypeEnum.DATE
    case BaseType.DATETIME:
      return FieldTypeEnum.DATETIME
    case BaseType.TIME:
      return FieldTypeEnum.TIME
    case BaseType.BOOLEAN:
      return FieldTypeEnum.CHECKBOX
    case BaseType.ENUM:
      return FieldTypeEnum.SINGLE_SELECT
    case BaseType.ARRAY:
      return FieldTypeEnum.MULTI_SELECT
    case BaseType.ADDRESS:
      return FieldTypeEnum.ADDRESS_STRUCT
    case BaseType.CURRENCY:
      return FieldTypeEnum.CURRENCY
    case BaseType.FILE:
      return FieldTypeEnum.FILE
    case BaseType.RELATION:
      return FieldTypeEnum.RELATIONSHIP
    case BaseType.ACTOR:
      return FieldTypeEnum.ACTOR
    case BaseType.TAGS:
      return FieldTypeEnum.TAGS
    default:
      return FieldTypeEnum.TEXT
  }
}

/**
 * Check if field type needs enum options for select/dropdown
 */
export function fieldTypeNeedsEnumOptions(fieldType: FieldType | string): boolean {
  const enumTypes = [FieldTypeEnum.SINGLE_SELECT, FieldTypeEnum.MULTI_SELECT, FieldTypeEnum.TAGS]
  return enumTypes.some((type) => type === fieldType)
}

/**
 * Check if field type is a relationship
 */
export function fieldTypeIsRelationship(fieldType: FieldType | string): boolean {
  return fieldType === FieldTypeEnum.RELATIONSHIP
}

/**
 * Extract enum options from field.options
 * Handles both array format and object format
 */
export function extractEnumOptions(
  options: unknown
): Array<{ label: string; value: string }> | undefined {
  if (!options) return undefined

  // Direct array format: [{ label, value }, ...]
  if (Array.isArray(options)) {
    return options as Array<{ label: string; value: string }>
  }

  // Object format with options key: { options: [{ label, value }, ...] }
  if (typeof options === 'object' && 'options' in options) {
    const optionsObj = options as { options?: unknown }
    if (Array.isArray(optionsObj.options)) {
      return optionsObj.options as Array<{ label: string; value: string }>
    }
  }

  return undefined
}
