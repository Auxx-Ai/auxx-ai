// packages/lib/src/workflow-engine/utils/default-values.ts

import { BaseType } from '../core/types'

/**
 * Get appropriate default value for a given data type
 * Provides sensible defaults for each BaseType when initializing new values
 *
 * @param type - The BaseType to get default value for
 * @returns Default value appropriate for the type
 *
 * @example
 * ```typescript
 * getDefaultValueForType(BaseType.NUMBER)  // Returns: 0
 * getDefaultValueForType(BaseType.STRING)  // Returns: ''
 * getDefaultValueForType(BaseType.DATE)    // Returns: '2025-01-14'
 * ```
 */
export function getDefaultValueForType(type?: BaseType): any {
  switch (type) {
    case BaseType.NUMBER:
      return 0
    case BaseType.BOOLEAN:
      return false
    case BaseType.DATE:
      return new Date().toISOString().split('T')[0] // YYYY-MM-DD
    case BaseType.DATETIME:
      return new Date().toISOString().slice(0, 16) // YYYY-MM-DDTHH:mm
    case BaseType.TIME:
      return '09:00'
    case BaseType.URL:
      return 'https://'
    case BaseType.EMAIL:
      return ''
    case BaseType.PHONE:
      return ''
    case BaseType.CURRENCY:
      return 0
    case BaseType.SECRET:
      return ''
    case BaseType.ARRAY:
      return []
    case BaseType.OBJECT:
      return {}
    case BaseType.JSON:
      return '{}'
    case BaseType.FILE:
      return null
    case BaseType.REFERENCE:
      return null
    case BaseType.RELATION:
      return null
    case BaseType.ENUM:
      return ''
    case BaseType.NULL:
      return null
    case BaseType.ANY:
      return ''
    case BaseType.STRING:
    default:
      return ''
  }
}
