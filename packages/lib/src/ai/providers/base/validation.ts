// packages/lib/src/ai/providers/base/validation.ts

import type { CredentialFormField } from '../types'
import type { ProviderCredentials, SchemaValidationResult } from './types'

/**
 * Common validation utilities for provider credentials
 */
export class ValidationUtils {
  /**
   * Validate credentials against a schema
   */
  static validateCredentialSchema(
    credentials: Record<string, any>,
    schema: CredentialFormField[]
  ): SchemaValidationResult {
    const fieldErrors: Record<string, string> = {}
    let hasErrors = false

    for (const field of schema) {
      const value = credentials[field.variable]
      const fieldError = ValidationUtils.validateField(value, field)

      if (fieldError) {
        fieldErrors[field.variable] = fieldError
        hasErrors = true
      }
    }

    if (hasErrors) {
      return {
        isValid: false,
        error: 'Credential validation failed',
        fieldErrors,
      }
    }

    return { isValid: true }
  }

  /**
   * Validate a single field against its schema
   */
  static validateField(value: any, field: CredentialFormField): string | null {
    // Check required fields
    if (field.required && ValidationUtils.isEmpty(value)) {
      return `${field.label} is required`
    }

    // If field is not required and empty, skip further validation
    if (!field.required && ValidationUtils.isEmpty(value)) {
      return null
    }

    // Type validation
    switch (field.type) {
      case 'secret-input':
      case 'text-input':
        if (typeof value !== 'string') {
          return `${field.label} must be a string`
        }
        break

      case 'number-input':
        if (typeof value !== 'number' && !ValidationUtils.isNumericString(value)) {
          return `${field.label} must be a number`
        }
        break

      case 'checkbox':
        if (typeof value !== 'boolean') {
          return `${field.label} must be a boolean`
        }
        break

      case 'select':
        if (field.options && !field.options.includes(String(value))) {
          return `${field.label} must be one of: ${field.options.join(', ')}`
        }
        break
    }

    // Pattern validation
    if (field.validation?.pattern && typeof value === 'string') {
      const regex = new RegExp(field.validation.pattern)
      if (!regex.test(value)) {
        return field.validation.message || `${field.label} format is invalid`
      }
    }

    // Min/Max validation for numbers
    if (field.validation && (field.type === 'number-input' || typeof value === 'number')) {
      const numValue = typeof value === 'number' ? value : parseFloat(value)

      if (field.validation.min !== undefined && numValue < field.validation.min) {
        return `${field.label} must be at least ${field.validation.min}`
      }

      if (field.validation.max !== undefined && numValue > field.validation.max) {
        return `${field.label} must be at most ${field.validation.max}`
      }
    }

    // String length validation
    if (field.validation && typeof value === 'string') {
      if (field.validation.min !== undefined && value.length < field.validation.min) {
        return `${field.label} must be at least ${field.validation.min} characters`
      }

      if (field.validation.max !== undefined && value.length > field.validation.max) {
        return `${field.label} must be at most ${field.validation.max} characters`
      }
    }

    return null
  }

  /**
   * Check if a value is considered empty
   */
  static isEmpty(value: any): boolean {
    return (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0)
    )
  }

  /**
   * Check if a string represents a number
   */
  static isNumericString(value: any): boolean {
    return typeof value === 'string' && !isNaN(Number(value)) && !isNaN(parseFloat(value))
  }

  /**
   * Mask sensitive credential values
   */
  static maskCredentialValue(value: string, fieldType: string = 'secret-input'): string {
    if (!value || typeof value !== 'string') {
      return '••••••••'
    }

    if (fieldType === 'secret-input') {
      if (value.length < 8) {
        return '••••••••'
      }

      if (value.startsWith('sk-') || value.startsWith('pk-')) {
        return value.slice(0, 3) + '••••••••' + value.slice(-4)
      }

      return value.slice(0, 2) + '••••••••' + value.slice(-2)
    }

    // Don't mask non-secret fields
    return value
  }

  /**
   * Hash credentials for cache key generation
   */
  static hashCredentials(credentials: ProviderCredentials): string {
    const sortedKeys = Object.keys(credentials).sort()
    const keyValuePairs = sortedKeys.map((key) => `${key}:${credentials[key]}`)

    // Simple hash function (in production, use a proper crypto hash)
    let hash = 0
    const str = keyValuePairs.join('|')

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }

    return Math.abs(hash).toString(36)
  }

  /**
   * Extract specific credential fields based on multiple naming patterns
   */
  static extractCredentialField(
    credentials: Record<string, any>,
    baseFieldName: string,
    providerId: string
  ): any {
    // Try multiple naming patterns in order of preference
    const patterns = [
      baseFieldName, // exact match
      `${providerId}_${baseFieldName}`, // provider_field
      `${providerId.toUpperCase()}_${baseFieldName.toUpperCase()}`, // PROVIDER_FIELD
      baseFieldName.replace('_', ''), // remove underscores
      baseFieldName.replace(/_/g, ''), // remove all underscores
    ]

    for (const pattern of patterns) {
      if (Object.hasOwn(credentials, pattern) && credentials[pattern] !== undefined) {
        return credentials[pattern]
      }
    }

    return undefined
  }
}
