// packages/lib/src/ai/providers/base/validation.ts

import type { ProviderCredentials } from './types'

/**
 * Common validation utilities for provider credentials
 */
export class ValidationUtils {
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
    return (
      typeof value === 'string' && !Number.isNaN(Number(value)) && !Number.isNaN(parseFloat(value))
    )
  }

  /**
   * Mask sensitive credential values. `secret` keys off the `ConnectionVariable.secret`
   * flag; non-secret fields pass through unmasked.
   */
  static maskCredentialValue(value: string, secret = true): string {
    if (!value || typeof value !== 'string') {
      return '••••••••'
    }

    if (secret) {
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
