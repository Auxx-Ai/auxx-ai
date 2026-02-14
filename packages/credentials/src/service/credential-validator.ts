// packages/credentials/src/service/credential-validator.ts

import { createScopedLogger } from '@auxx/logger'
import type { INodeProperty, INodePropertyValidation, NodeData } from '@auxx/workflow-nodes/types'

const logger = createScopedLogger('credential-validator')

export interface ValidationError {
  field: string
  message: string
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
}

/**
 * Credential validation service
 */
export class CredentialValidator {
  /**
   * Validate credential data against property definitions
   */
  static validate(
    data: NodeData,
    properties: INodeProperty[],
    editMode: boolean = false
  ): ValidationResult {
    const errors: ValidationError[] = []

    for (const property of properties) {
      // Skip notice and hidden fields
      if (property.type === 'notice' || property.type === 'hidden') {
        continue
      }

      const fieldName = property.name
      const value = data[fieldName]
      const error = CredentialValidator.validateField(value, property, editMode)

      if (error) {
        errors.push({ field: fieldName, message: error })
      }
    }

    const isValid = errors.length === 0

    if (!isValid) {
      logger.warn('Credential validation failed', {
        errors: errors.map((e) => `${e.field}: ${e.message}`),
      })
    }

    return { isValid, errors }
  }

  /**
   * Validate a single field value
   */
  private static validateField(
    value: any,
    property: INodeProperty,
    editMode: boolean
  ): string | null {
    const { required, displayName, validation } = property

    // For sensitive fields in edit mode, allow empty values (existing encrypted data will be preserved)
    const isSensitiveField = CredentialValidator.isSensitiveField(property)
    const allowEmpty = editMode && isSensitiveField

    // Check required field - in edit mode, sensitive fields can be empty (keeping existing value)
    if (required && !allowEmpty && (value === undefined || value === null || value === '')) {
      return `${displayName} is required`
    }

    // If field is empty and not required (or allowed to be empty in edit mode), skip validation
    if (value === undefined || value === null || value === '') {
      return null
    }

    // Apply validation rules only if the field has a value
    if (validation) {
      return CredentialValidator.validateWithRules(value, validation, displayName)
    }

    return null
  }

  /**
   * Validate value against validation rules
   */
  private static validateWithRules(
    value: any,
    validation: INodePropertyValidation,
    displayName: string
  ): string | null {
    const stringValue = String(value)
    const numericValue = Number(value)

    // String length validation
    if (validation.minLength !== undefined && stringValue.length < validation.minLength) {
      return (
        validation.errorMessage ||
        `${displayName} must be at least ${validation.minLength} characters`
      )
    }

    if (validation.maxLength !== undefined && stringValue.length > validation.maxLength) {
      return (
        validation.errorMessage ||
        `${displayName} must be no more than ${validation.maxLength} characters`
      )
    }

    // Numeric range validation
    if (validation.min !== undefined && (isNaN(numericValue) || numericValue < validation.min)) {
      return validation.errorMessage || `${displayName} must be at least ${validation.min}`
    }

    if (validation.max !== undefined && (isNaN(numericValue) || numericValue > validation.max)) {
      return validation.errorMessage || `${displayName} must be no more than ${validation.max}`
    }

    // Pattern validation
    if (validation.pattern) {
      const pattern =
        typeof validation.pattern === 'string' ? new RegExp(validation.pattern) : validation.pattern

      if (!pattern.test(stringValue)) {
        return validation.errorMessage || `${displayName} format is invalid`
      }
    }

    // Email validation
    if (validation.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(stringValue)) {
        return validation.errorMessage || `${displayName} must be a valid email address`
      }
    }

    // URL validation
    if (validation.url) {
      try {
        new URL(stringValue)
      } catch {
        return validation.errorMessage || `${displayName} must be a valid URL`
      }
    }

    // Port validation
    if (validation.port) {
      const port = numericValue
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return validation.errorMessage || `${displayName} must be a valid port number (1-65535)`
      }
    }

    return null
  }

  /**
   * Check if a field contains sensitive data
   */
  private static isSensitiveField(property: INodeProperty): boolean {
    // Check field type
    if (property.type === 'password' || property.typeOptions?.password) {
      return true
    }

    // Check field name patterns
    const fieldName = property.name.toLowerCase()
    const sensitivePatterns = [
      'password',
      'passwd',
      'pwd',
      'key',
      'secret',
      'token',
      'auth',
      'credential',
      'privatekey',
      'passphrase',
    ]

    return sensitivePatterns.some((pattern) => fieldName.includes(pattern))
  }

  /**
   * Get credential type properties by type name
   */
  static getCredentialProperties(credentialType: string): INodeProperty[] {
    // This would normally load from a registry or database
    // For now, return empty array - this should be implemented based on your credential registry
    logger.warn('getCredentialProperties not implemented', { credentialType })
    return []
  }
}
