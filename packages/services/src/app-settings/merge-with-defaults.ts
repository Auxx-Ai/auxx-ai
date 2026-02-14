// packages/services/src/app-settings/merge-with-defaults.ts

/**
 * Settings schema field type (from SDK)
 * Represents a single field in the settings schema
 */
export interface SettingsSchemaField {
  type: 'string' | 'number' | 'boolean' | 'select' | 'struct'
  is_optional?: boolean
  fields?: Record<string, SettingsSchemaField> // For struct type
  _metadata?: {
    defaultValue?: any
    label?: string
    description?: string
    placeholder?: string
    // String constraints
    minLength?: number
    maxLength?: number
    pattern?: string
    // Number constraints
    min?: number
    max?: number
    step?: number
    // Select options
    options?: string[]
    // Other metadata
    [key: string]: any
  }
}

/**
 * Form schema type (collection of fields)
 * @deprecated Use Record<string, SettingsSchemaField> instead
 */
export type FormSchema = Record<string, SettingsSchemaField>

/**
 * Merge saved settings with schema defaults
 *
 * Rules:
 * 1. Saved values override defaults
 * 2. New fields get their default values
 * 3. Removed fields are ignored
 * 4. Type mismatches are handled gracefully
 * 5. Nested structs are merged recursively
 */
export function mergeSettingsWithDefaults(
  savedSettings: Record<string, any>,
  schema: FormSchema
): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [key, field] of Object.entries(schema)) {
    // Handle struct (nested object) - recursively merge
    if (field.type === 'struct' && field.fields) {
      const savedNested = savedSettings[key] || {}
      result[key] = mergeSettingsWithDefaults(savedNested, field.fields)
      continue
    }

    // Get default value for this field
    const metadata = field._metadata
    let defaultValue: any

    if (metadata?.defaultValue !== undefined) {
      defaultValue = metadata.defaultValue
    } else if (field.type === 'boolean') {
      defaultValue = false
    } else if (field.is_optional) {
      defaultValue = undefined
    } else {
      defaultValue = undefined
    }

    // Check if saved value exists
    if (key in savedSettings) {
      const savedValue = savedSettings[key]

      // Validate type matches
      if (validateType(field.type, savedValue, field._metadata?.options)) {
        result[key] = savedValue
      } else {
        console.warn(
          `[mergeSettingsWithDefaults] Type mismatch for "${key}": expected ${field.type}, got ${typeof savedValue}. Using default.`
        )
        result[key] = defaultValue
      }
    } else {
      result[key] = defaultValue
    }
  }

  return result
}

/**
 * Validate that a value matches the expected type
 *
 * @param type - Expected field type
 * @param value - Value to validate
 * @param options - Valid options for select type
 * @returns true if value matches type, false otherwise
 */
function validateType(type: string, value: any, options?: string[]): boolean {
  const actualType = typeof value

  switch (type) {
    case 'string':
      return actualType === 'string'
    case 'number':
      return actualType === 'number'
    case 'boolean':
      return actualType === 'boolean'
    case 'select':
      return actualType === 'string' && (!options || options.includes(value))
    case 'struct':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    default:
      return false
  }
}

/**
 * Extract default values from a form schema
 * Recursively extracts defaults for nested struct fields
 *
 * @param schema - The settings schema
 * @returns Object with default values
 */
export function extractDefaults(schema: FormSchema): Record<string, any> {
  const defaults: Record<string, any> = {}

  for (const [key, field] of Object.entries(schema)) {
    // Handle struct (nested object) - recursively extract defaults
    if (field.type === 'struct' && field.fields) {
      defaults[key] = extractDefaults(field.fields)
      continue
    }

    const metadata = field._metadata

    // Check if field has a default value
    if (metadata?.defaultValue !== undefined) {
      defaults[key] = metadata.defaultValue
    } else if (field.type === 'boolean') {
      // Booleans default to false if not specified
      defaults[key] = false
    }
    // Optional fields without defaults remain undefined
  }

  return defaults
}
