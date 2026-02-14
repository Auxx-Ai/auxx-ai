// packages/lib/src/import/fields/suggest-resolution-type.ts

import type { ResolutionType } from '../types/resolution'
import type { ImportableField } from './get-importable-fields'

/**
 * Suggest the best resolution type for a field based on its type and name.
 *
 * @param field - The importable field
 * @returns Suggested resolution type
 */
export function suggestResolutionType(field: ImportableField): ResolutionType {
  // Check for relation fields
  if (field.isRelation) {
    return 'relation:match'
  }

  // Check for enum/select fields
  if (field.options && field.options.length > 0) {
    return 'select:value'
  }

  // Map field types to resolution types
  switch (field.type) {
    case 'number':
    case 'integer':
      return 'number:integer'

    case 'decimal':
    case 'float':
    case 'currency':
      return 'number:decimal'

    case 'date':
      return 'date:iso'

    case 'datetime':
    case 'timestamp':
      return 'datetime:iso'

    case 'boolean':
      return 'boolean:truthy'

    case 'email':
      return 'email:value'

    case 'phone':
      return 'phone:value'

    case 'url':
    case 'domain':
      return 'domain:value'

    case 'array':
    case 'tags':
      return 'array:split'

    case 'multiselect':
      return 'multiselect:split'

    case 'select':
      return 'select:value'

    case 'text':
    case 'string':
    default: {
      // Check for known field names that have specific types
      const key = field.key.toLowerCase()

      if (key === 'email' || key.includes('email')) {
        return 'email:value'
      }

      if (key === 'phone' || key.includes('phone') || key.includes('mobile')) {
        return 'phone:value'
      }

      if (key === 'id' || key === 'externalid' || key.includes('_id')) {
        return 'text:cuid'
      }

      if (key.includes('date') || key.includes('at')) {
        return 'date:iso'
      }

      return 'text:value'
    }
  }
}

/**
 * Get available resolution types for a field type.
 * Returns types that make sense for the given field type.
 *
 * @param fieldType - The field type
 * @returns Array of valid resolution types
 */
export function getValidResolutionTypes(fieldType: string): ResolutionType[] {
  switch (fieldType) {
    case 'number':
    case 'integer':
      return ['number:integer', 'number:decimal', 'text:value']

    case 'decimal':
    case 'float':
    case 'currency':
      return ['number:decimal', 'number:integer', 'text:value']

    case 'date':
      return ['date:iso', 'date:custom', 'text:value']

    case 'datetime':
    case 'timestamp':
      return ['datetime:iso', 'datetime:custom', 'date:iso', 'text:value']

    case 'boolean':
      return ['boolean:truthy', 'text:value']

    case 'email':
      return ['email:value', 'text:value']

    case 'phone':
      return ['phone:value', 'text:value']

    case 'url':
    case 'domain':
      return ['domain:value', 'text:value']

    case 'select':
      return ['select:value', 'select:create', 'text:value']

    case 'multiselect':
      return ['multiselect:split', 'select:value', 'array:split', 'text:value']

    case 'array':
    case 'tags':
      return ['array:split', 'text:value']

    case 'relation':
      return ['relation:id', 'relation:match', 'relation:create', 'text:cuid', 'text:value']

    case 'text':
    case 'string':
    default:
      return [
        'text:value',
        'text:cuid',
        'email:value',
        'phone:value',
        'number:integer',
        'number:decimal',
        'date:iso',
        'boolean:truthy',
      ]
  }
}
