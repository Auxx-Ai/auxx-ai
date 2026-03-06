// packages/lib/src/workflow-engine/utils/type-compatibility.ts

import { BaseType } from '../core/types'

/**
 * Type compatibility matrix for variable selection
 * Defines which variable types can be used with which field types
 *
 * Design Philosophy:
 * - `ANY` type is universally compatible (wildcard)
 * - `STRING` is the most flexible destination type (accepts almost everything via coercion)
 * - Primitive types support string coercion for flexibility
 * - Complex types (OBJECT, ARRAY) are strict to prevent runtime errors
 */
const TYPE_COMPATIBILITY_MAP: Record<BaseType, BaseType[]> = {
  // ANY accepts everything (universal wildcard)
  [BaseType.ANY]: Object.values(BaseType),

  // STRING accepts most types (via string coercion)
  [BaseType.STRING]: [
    BaseType.ANY,
    BaseType.STRING,
    BaseType.NUMBER,
    BaseType.BOOLEAN,
    BaseType.DATE,
    BaseType.DATETIME,
    BaseType.TIME,
    BaseType.EMAIL,
    BaseType.URL,
    BaseType.PHONE,
    BaseType.ENUM,
    BaseType.FILE,
    BaseType.REFERENCE,
  ],

  // NUMBER accepts numeric types and strings (parseable to numbers)
  [BaseType.NUMBER]: [
    BaseType.ANY,
    BaseType.NUMBER,
    BaseType.STRING,
    BaseType.BOOLEAN, // 0/1 conversion
  ],

  // BOOLEAN accepts boolean-like types
  [BaseType.BOOLEAN]: [
    BaseType.ANY,
    BaseType.BOOLEAN,
    BaseType.STRING, // "true"/"false" strings
    BaseType.NUMBER, // 0/1 conversion
  ],

  // DATE accepts date types and strings (parseable to dates)
  [BaseType.DATE]: [
    BaseType.ANY,
    BaseType.DATE,
    BaseType.DATETIME, // Can extract date part
    BaseType.STRING, // ISO date strings
    BaseType.NUMBER, // Unix timestamps
  ],

  // DATETIME accepts datetime types and strings
  [BaseType.DATETIME]: [
    BaseType.ANY,
    BaseType.DATETIME,
    BaseType.DATE, // Can extend to datetime
    BaseType.STRING, // ISO datetime strings
    BaseType.NUMBER, // Unix timestamps
  ],

  // TIME accepts time types and strings
  [BaseType.TIME]: [
    BaseType.ANY,
    BaseType.TIME,
    BaseType.STRING, // Time strings like "14:30"
  ],

  // EMAIL accepts email and string types
  [BaseType.EMAIL]: [BaseType.ANY, BaseType.EMAIL, BaseType.STRING],

  // URL accepts URL and string types
  [BaseType.URL]: [BaseType.ANY, BaseType.URL, BaseType.STRING],

  // PHONE accepts phone and string types
  [BaseType.PHONE]: [BaseType.ANY, BaseType.PHONE, BaseType.STRING],

  // ENUM accepts enum and string types
  [BaseType.ENUM]: [BaseType.ANY, BaseType.ENUM, BaseType.STRING],

  // REFERENCE accepts reference and string types (IDs)
  [BaseType.REFERENCE]: [BaseType.ANY, BaseType.REFERENCE, BaseType.STRING],

  // FILE accepts file and string types (file paths)
  [BaseType.FILE]: [BaseType.ANY, BaseType.FILE, BaseType.STRING],

  // JSON accepts JSON and string types (JSON strings)
  [BaseType.JSON]: [
    BaseType.ANY,
    BaseType.JSON,
    BaseType.STRING,
    BaseType.OBJECT, // Can serialize objects to JSON
    BaseType.ARRAY, // Can serialize arrays to JSON
  ],

  // CURRENCY accepts numeric types (stored as integer cents)
  [BaseType.CURRENCY]: [
    BaseType.ANY,
    BaseType.CURRENCY,
    BaseType.NUMBER, // Raw numbers
    BaseType.STRING, // Parseable number strings
  ],

  // SECRET accepts secret and string types
  [BaseType.SECRET]: [BaseType.ANY, BaseType.SECRET, BaseType.STRING],

  // OBJECT is strict - only accepts objects and ANY
  [BaseType.OBJECT]: [
    BaseType.ANY,
    BaseType.OBJECT,
    BaseType.JSON, // JSON is structured object data
  ],

  // RELATION accepts objects with referenceId property
  [BaseType.RELATION]: [
    BaseType.ANY,
    BaseType.OBJECT, // Primary use case - objects with .referenceId
    BaseType.RELATION, // Other relation variables
    BaseType.JSON, // Structured data with referenceId
  ],

  // ARRAY is strict - only accepts arrays and ANY
  [BaseType.ARRAY]: [BaseType.ANY, BaseType.ARRAY],

  // NULL accepts only null and ANY
  [BaseType.NULL]: [BaseType.ANY, BaseType.NULL],
}

/**
 * Check if a variable type is compatible with allowed field types
 *
 * @param variableType - The type of the variable (e.g., BaseType.STRING)
 * @param allowedTypes - Array of types that the field accepts (e.g., [BaseType.STRING, BaseType.NUMBER])
 * @returns true if the variable type is compatible with any of the allowed types
 *
 * @example
 * ```typescript
 * // Check if a STRING variable can be used in a NUMBER field
 * isTypeCompatible(BaseType.STRING, [BaseType.NUMBER]) // true (STRING can parse to NUMBER)
 *
 * // Check if an ANY variable can be used in a STRING field
 * isTypeCompatible(BaseType.ANY, [BaseType.STRING]) // true (ANY is universal)
 *
 * // Check if a NUMBER variable can be used in an OBJECT field
 * isTypeCompatible(BaseType.NUMBER, [BaseType.OBJECT]) // false (strict type)
 * ```
 */
export function isTypeCompatible(variableType: BaseType, allowedTypes: BaseType[]): boolean {
  // If no type restrictions, allow everything
  if (allowedTypes.length === 0) {
    return true
  }

  // If variable is ANY type, it's compatible with everything
  if (variableType === BaseType.ANY) {
    return true
  }

  // Check if variable type is compatible with any of the allowed types
  return allowedTypes.some((allowedType) => {
    // If field accepts ANY, accept all variable types
    if (allowedType === BaseType.ANY) {
      return true
    }

    // Check compatibility matrix
    const compatibleTypes = TYPE_COMPATIBILITY_MAP[allowedType]
    return compatibleTypes?.includes(variableType) ?? false
  })
}

/**
 * Get all compatible types for a given field type
 * Useful for documentation and UI hints
 *
 * @param fieldType - The field type to get compatible types for
 * @returns Array of compatible variable types
 *
 * @example
 * ```typescript
 * getCompatibleTypes(BaseType.STRING)
 * // Returns: [BaseType.ANY, BaseType.STRING, BaseType.NUMBER, ...]
 * ```
 */
export function getCompatibleTypes(fieldType: BaseType): BaseType[] {
  return TYPE_COMPATIBILITY_MAP[fieldType] || []
}
