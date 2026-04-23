// packages/services/src/custom-fields/utils/normalize-value.ts

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import type { SelectOption } from '../types'

/**
 * Extract raw value from {"data": x} wrapper if present
 *
 * @param value - Value that may or may not be wrapped
 * @returns Unwrapped value
 */
function unwrapValue(value: any): any {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'data' in value &&
    Object.keys(value).length === 1
  ) {
    return value.data
  }
  return value
}

/**
 * Normalize and validate custom field value based on field type
 *
 * This function:
 * 1. Unwraps {"data": x} format if present
 * 2. Validates value against field type
 * 3. Validates against field options (for SELECT types)
 * 4. Coerces values to correct types
 * 5. Re-wraps in {"data": x} format for storage
 *
 * @param value - Raw value from workflow or API
 * @param field - Custom field definition with type and options
 * @returns Normalized value wrapped in {"data": x} format
 */
export function normalizeFieldValue(
  value: any,
  field: { type: FieldType; name: string; options?: any }
): { data: any } {
  // Handle null/undefined - return wrapped null
  if (value === null || value === undefined) {
    return { data: null }
  }

  // Unwrap if already in {"data": x} format
  const rawValue = unwrapValue(value)

  // Handle null/undefined after unwrapping
  if (rawValue === null || rawValue === undefined) {
    return { data: null }
  }

  // Empty string handling - return null for most types
  if (typeof rawValue === 'string' && rawValue.trim() === '') {
    return { data: null }
  }

  // Type-specific normalization
  switch (field.type) {
    case FieldTypeEnum.CHECKBOX: {
      // Parse string representations
      if (typeof rawValue === 'string') {
        const lower = rawValue.toLowerCase().trim()
        if (lower === 'true' || lower === '1' || lower === 'yes') {
          return { data: true }
        }
        if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') {
          return { data: false }
        }
        return { data: Boolean(rawValue) }
      }
      // Ensure boolean
      return { data: Boolean(rawValue) }
    }

    case FieldTypeEnum.SINGLE_SELECT: {
      // Validate against options
      const options = field.options?.options || []
      const stringValue = String(rawValue).trim()

      // If no options defined, accept any value
      if (options.length === 0) {
        return { data: stringValue }
      }

      // Check if value exists in options (by value or label)
      const validOption = options.find(
        (opt: SelectOption) => opt.value === stringValue || opt.label === stringValue
      )

      if (!validOption) {
        throw new Error(
          `Invalid value for field "${field.name}". ` +
            `Received: "${stringValue}". ` +
            `Valid options: ${options.map((o: SelectOption) => o.value).join(', ')}`
        )
      }

      return { data: validOption.value }
    }

    case FieldTypeEnum.MULTI_SELECT: {
      // Ensure array format
      let arrayValue: string[]
      if (typeof rawValue === 'string') {
        // Handle comma-separated strings
        arrayValue = rawValue
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      } else if (Array.isArray(rawValue)) {
        arrayValue = rawValue.map((v) => String(v).trim()).filter(Boolean)
      } else {
        arrayValue = [String(rawValue).trim()]
      }

      // Validate against options
      const options = field.options?.options || []
      if (options.length > 0) {
        const validValues = options.map((o: SelectOption) => o.value)
        const invalidValues = arrayValue.filter((v) => !validValues.includes(v))

        if (invalidValues.length > 0) {
          throw new Error(
            `Invalid values for field "${field.name}": ${invalidValues.join(', ')}. ` +
              `Valid options: ${validValues.join(', ')}`
          )
        }
      }

      return { data: arrayValue }
    }

    case FieldTypeEnum.NUMBER: {
      if (typeof rawValue === 'number') {
        if (Number.isNaN(rawValue) || !isFinite(rawValue)) {
          throw new Error(`Invalid NUMBER value for field "${field.name}": ${rawValue}`)
        }
        return { data: rawValue }
      }
      if (typeof rawValue === 'string') {
        const parsed = parseFloat(rawValue.trim())
        if (Number.isNaN(parsed) || !isFinite(parsed)) {
          throw new Error(`Invalid NUMBER value for field "${field.name}": "${rawValue}"`)
        }
        return { data: parsed }
      }
      throw new Error(`Cannot convert to NUMBER for field "${field.name}": ${typeof rawValue}`)
    }

    case FieldTypeEnum.CURRENCY: {
      // Value should be stored as cents (integer)
      if (typeof rawValue === 'number') {
        // Already a number - ensure it's an integer (cents)
        if (!Number.isInteger(rawValue)) {
          // Assume it was passed as dollars, convert to cents
          const cents = Math.round(rawValue * 100)
          return { data: cents }
        }
        return { data: rawValue }
      }
      if (typeof rawValue === 'string') {
        // Remove currency symbols and commas
        const cleaned = rawValue.replace(/[$€£¥,\s]/g, '').trim()
        const parsed = parseFloat(cleaned)
        if (Number.isNaN(parsed) || !isFinite(parsed)) {
          throw new Error(`Invalid CURRENCY value for field "${field.name}": "${rawValue}"`)
        }
        // Convert to cents
        const cents = Math.round(parsed * 100)
        return { data: cents }
      }
      throw new Error(`Cannot convert to CURRENCY for field "${field.name}": ${typeof rawValue}`)
    }

    case FieldTypeEnum.DATE:
    case FieldTypeEnum.DATETIME:
    case FieldTypeEnum.TIME: {
      if (rawValue instanceof Date) {
        if (Number.isNaN(rawValue.getTime())) {
          throw new Error(`Invalid ${field.type} value for field "${field.name}"`)
        }
        return { data: rawValue.toISOString() }
      }
      if (typeof rawValue === 'string') {
        const date = new Date(rawValue.trim())
        if (Number.isNaN(date.getTime())) {
          throw new Error(`Invalid ${field.type} value for field "${field.name}": "${rawValue}"`)
        }
        return { data: date.toISOString() }
      }
      throw new Error(
        `Cannot convert to ${field.type} for field "${field.name}": ${typeof rawValue}`
      )
    }

    case FieldTypeEnum.TAGS: {
      // Ensure array format
      if (Array.isArray(rawValue)) {
        return { data: rawValue.map((v) => String(v).trim()).filter(Boolean) }
      }
      if (typeof rawValue === 'string') {
        return {
          data: rawValue
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        }
      }
      return { data: [String(rawValue).trim()] }
    }

    case FieldTypeEnum.ADDRESS_STRUCT: {
      // Validate object structure
      if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) {
        throw new Error(`ADDRESS_STRUCT field "${field.name}" requires an object`)
      }

      const address = {
        street1: rawValue.street1 ? String(rawValue.street1).trim() : '',
        street2: rawValue.street2 ? String(rawValue.street2).trim() : '',
        city: rawValue.city ? String(rawValue.city).trim() : '',
        state: rawValue.state ? String(rawValue.state).trim() : '',
        zipCode: rawValue.zipCode ? String(rawValue.zipCode).trim() : '',
        country: rawValue.country ? String(rawValue.country).trim() : '',
      }

      return { data: address }
    }

    case FieldTypeEnum.NAME: {
      // Validate object structure
      if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) {
        throw new Error(
          `NAME field "${field.name}" requires an object with first and last properties`
        )
      }

      const name = {
        first: rawValue.first ? String(rawValue.first).trim() : '',
        last: rawValue.last ? String(rawValue.last).trim() : '',
      }

      return { data: name }
    }

    case FieldTypeEnum.FILE: {
      // Handle attachmentIds for file attachments
      if (typeof rawValue === 'object' && rawValue.attachmentIds) {
        return { data: rawValue }
      }
      // Validate file reference or URL (legacy/workflow support)
      if (typeof rawValue === 'string') {
        return { data: rawValue.trim() }
      }
      if (typeof rawValue === 'object' && rawValue.url) {
        return { data: String(rawValue.url).trim() }
      }
      return { data: null }
    }

    case FieldTypeEnum.TEXT:
    case FieldTypeEnum.RICH_TEXT:
    case FieldTypeEnum.EMAIL:
    case FieldTypeEnum.URL:
    case FieldTypeEnum.PHONE_INTL:
    case FieldTypeEnum.ADDRESS: {
      // Simple string coercion
      return { data: String(rawValue).trim() }
    }

    default: {
      // Unknown type - pass through with warning
      console.warn(`Unknown field type "${field.type}" for field "${field.name}", passing through`)
      return { data: rawValue }
    }
  }
}
