// packages/lib/src/field-values/converters/json.ts

import type { JsonFieldValue, TypedFieldValue, TypedFieldValueInput } from '@auxx/types/field-value'
import type { FieldValueConverter } from './index'

/**
 * Generic JSON converter for ADDRESS_STRUCT and other JSON-based field types.
 * Stores as valueJson in the database.
 */
export const jsonConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts JSON object, JSON string, or null/undefined.
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'json') {
        const jsonValue = (typed as JsonFieldValue).value
        if (!jsonValue || Object.keys(jsonValue).length === 0) return null
        return { type: 'json', value: jsonValue }
      }
    }

    // Handle empty string
    if (typeof value === 'string' && value.trim() === '') {
      return null
    }

    // Handle JSON object
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Skip objects that have 'type' key (already handled above)
      if ('type' in value) {
        return null
      }
      return { type: 'json', value: value as Record<string, unknown> }
    }

    // Handle JSON string
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return { type: 'json', value: parsed }
        }
      } catch {
        // Not valid JSON string
        return null
      }
    }

    return null
  },

  /**
   * Convert TypedFieldValue/Input to raw JSON object.
   */
  toRawValue(
    value: TypedFieldValue | TypedFieldValueInput | unknown
  ): Record<string, unknown> | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle TypedFieldValue or TypedFieldValueInput
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'json') {
        return (typed as JsonFieldValue).value ?? null
      }
      return null
    }

    // Handle raw object passthrough
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }

    return null
  },

  /**
   * Convert TypedFieldValue to display string.
   * Returns JSON stringified value.
   */
  toDisplayValue(value: TypedFieldValue): string {
    if (!value) {
      return ''
    }

    const typed = value as JsonFieldValue
    const jsonValue = typed.value

    if (!jsonValue || Object.keys(jsonValue).length === 0) {
      return ''
    }

    return JSON.stringify(jsonValue)
  },
}

/**
 * NAME field value structure
 */
export interface NameValue {
  firstName?: string
  lastName?: string
}

/**
 * Converter for NAME field type.
 * Stores as valueJson with { firstName, lastName } structure.
 */
export const nameConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts name object, full name string, or null/undefined.
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'json') {
        const jsonValue = (typed as JsonFieldValue).value as NameValue
        if (!jsonValue?.firstName && !jsonValue?.lastName) return null
        return { type: 'json', value: jsonValue }
      }
    }

    // Handle empty string
    if (typeof value === 'string' && value.trim() === '') {
      return null
    }

    // Handle name object { firstName, lastName }
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>

      // Check for name fields
      const firstName = typeof obj.firstName === 'string' ? obj.firstName.trim() : ''
      const lastName = typeof obj.lastName === 'string' ? obj.lastName.trim() : ''

      if (!firstName && !lastName) {
        return null
      }

      return {
        type: 'json',
        value: { firstName, lastName } as Record<string, unknown>,
      }
    }

    // Handle full name string (split by space)
    if (typeof value === 'string') {
      const parts = value.trim().split(/\s+/)
      if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) {
        return null
      }

      const firstName = parts[0] || ''
      const lastName = parts.slice(1).join(' ') || ''

      return {
        type: 'json',
        value: { firstName, lastName } as Record<string, unknown>,
      }
    }

    return null
  },

  /**
   * Convert TypedFieldValue/Input to raw name object.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): NameValue | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle TypedFieldValue or TypedFieldValueInput
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'json') {
        const jsonValue = (typed as JsonFieldValue).value as NameValue
        if (!jsonValue?.firstName && !jsonValue?.lastName) return null
        return {
          firstName: jsonValue.firstName || '',
          lastName: jsonValue.lastName || '',
        }
      }
      return null
    }

    // Handle raw name object
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>
      const firstName = typeof obj.firstName === 'string' ? obj.firstName : ''
      const lastName = typeof obj.lastName === 'string' ? obj.lastName : ''
      if (!firstName && !lastName) return null
      return { firstName, lastName }
    }

    return null
  },

  /**
   * Convert TypedFieldValue to display string.
   * Returns "FirstName LastName" format.
   */
  toDisplayValue(value: TypedFieldValue): string {
    if (!value) {
      return ''
    }

    const typed = value as JsonFieldValue
    const nameValue = typed.value as NameValue

    if (!nameValue) {
      return ''
    }

    const firstName = nameValue.firstName || ''
    const lastName = nameValue.lastName || ''

    return [firstName, lastName].filter(Boolean).join(' ').trim()
  },
}

/**
 * FILE field value structure
 */
export interface FileValue {
  url: string
  name?: string
  size?: number
  mimeType?: string
}

/**
 * Converter for FILE field type.
 * Stores as valueJson with file metadata.
 */
export const fileConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts file object or null/undefined.
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'json') {
        const jsonValue = (typed as JsonFieldValue).value as FileValue
        if (!jsonValue?.url) return null
        return { type: 'json', value: jsonValue as Record<string, unknown> }
      }
    }

    // Handle file object { url, name?, size?, mimeType? }
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>

      // Must have url
      if (typeof obj.url !== 'string' || !obj.url) {
        return null
      }

      const fileValue: FileValue = {
        url: obj.url,
      }

      if (typeof obj.name === 'string') fileValue.name = obj.name
      if (typeof obj.size === 'number') fileValue.size = obj.size
      if (typeof obj.mimeType === 'string') fileValue.mimeType = obj.mimeType

      return { type: 'json', value: fileValue as Record<string, unknown> }
    }

    // Handle URL string
    if (typeof value === 'string' && value.trim()) {
      return {
        type: 'json',
        value: { url: value.trim() } as Record<string, unknown>,
      }
    }

    return null
  },

  /**
   * Convert TypedFieldValue/Input to raw file object.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): FileValue | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle TypedFieldValue or TypedFieldValueInput
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'json') {
        const jsonValue = (typed as JsonFieldValue).value as FileValue
        if (!jsonValue?.url) return null
        return jsonValue
      }
      return null
    }

    // Handle raw file object
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>
      if (typeof obj.url === 'string' && obj.url) {
        return obj as FileValue
      }
    }

    return null
  },

  /**
   * Convert TypedFieldValue to display string.
   * Returns the file name or URL.
   */
  toDisplayValue(value: TypedFieldValue): string {
    if (!value) {
      return ''
    }

    const typed = value as JsonFieldValue
    const fileValue = typed.value as FileValue

    if (!fileValue?.url) {
      return ''
    }

    // Return name if available, otherwise URL
    return fileValue.name || fileValue.url
  },
}
