// packages/lib/src/field-values/converters/phone.ts

import type { TextFieldValue, TypedFieldValue, TypedFieldValueInput } from '@auxx/types/field-value'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import type { FieldValueConverter, PhoneFieldOptions } from './index'

/**
 * Converter for PHONE_INTL field type.
 * Stores phone numbers in E.164 format (e.g., +14155551234).
 * Display formatting is handled via phoneFormat option.
 */
export const phoneConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts string phone number or null/undefined.
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'text') {
        const textValue = (typed as TextFieldValue).value
        if (!textValue || textValue.trim() === '') return null
        return { type: 'text', value: textValue }
      }
    }

    const stringValue = String(value).trim()
    if (stringValue === '') {
      return null
    }

    return { type: 'text', value: stringValue }
  },

  /**
   * Convert TypedFieldValue/Input to raw string value.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): string {
    if (value === null || value === undefined) {
      return ''
    }

    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'text') {
        return (typed as TextFieldValue).value ?? ''
      }
      return ''
    }

    return String(value)
  },

  /**
   * Convert TypedFieldValue to display string.
   * Applies phoneFormat option for formatting.
   */
  toDisplayValue(value: TypedFieldValue, options?: PhoneFieldOptions): string {
    if (!value) {
      return ''
    }

    const typed = value as TextFieldValue
    const rawValue = typed.value ?? ''

    if (!rawValue) {
      return ''
    }

    const phoneFormat = options?.phoneFormat ?? 'national'

    // Parse the phone number
    const phoneNumber = parsePhoneNumberFromString(rawValue)
    if (!phoneNumber) {
      return rawValue
    }

    switch (phoneFormat) {
      case 'raw':
        return rawValue
      case 'international':
        return phoneNumber.formatInternational()
      case 'national':
      default:
        return phoneNumber.formatNational()
    }
  },
}
