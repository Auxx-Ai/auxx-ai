// apps/web/src/app/(protected)/app/workflows/_components/credentials/validation-utils.ts

import type { INodeProperty, INodePropertyValidation } from '@auxx/workflow-nodes/types'

export interface ValidationResult {
  isValid: boolean
  message?: string
}

/**
 * Check if a field contains sensitive data
 */
function isSensitiveField(property: INodeProperty): boolean {
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
 * Validate a field value against its property validation rules
 */
export function validateFieldValue(
  value: any,
  property: INodeProperty,
  editMode: boolean = false
): ValidationResult {
  const { validation, required, displayName } = property

  // For sensitive fields in edit mode, allow empty values (existing encrypted data will be preserved)
  const isSensitive = isSensitiveField(property)
  const allowEmpty = editMode && isSensitive

  // Check required field
  if (required && !allowEmpty && (!value || value === '')) {
    return {
      isValid: false,
      message: `${displayName} is required`,
    }
  }

  // If field is not required and empty (or allowed to be empty in edit mode), it's valid
  if (!value || value === '') {
    return { isValid: true }
  }

  // Apply validation rules if they exist
  if (!validation) {
    return { isValid: true }
  }

  return validateWithRules(value, validation, displayName)
}

/**
 * Validate value against validation rules
 */
function validateWithRules(
  value: any,
  validation: INodePropertyValidation,
  displayName: string
): ValidationResult {
  const stringValue = String(value)
  const numericValue = Number(value)

  // String length validation
  if (validation.minLength !== undefined && stringValue.length < validation.minLength) {
    return {
      isValid: false,
      message:
        validation.errorMessage ||
        `${displayName} must be at least ${validation.minLength} characters`,
    }
  }

  if (validation.maxLength !== undefined && stringValue.length > validation.maxLength) {
    return {
      isValid: false,
      message:
        validation.errorMessage ||
        `${displayName} must be no more than ${validation.maxLength} characters`,
    }
  }

  // Numeric range validation
  if (validation.min !== undefined && numericValue < validation.min) {
    return {
      isValid: false,
      message: validation.errorMessage || `${displayName} must be at least ${validation.min}`,
    }
  }

  if (validation.max !== undefined && numericValue > validation.max) {
    return {
      isValid: false,
      message: validation.errorMessage || `${displayName} must be no more than ${validation.max}`,
    }
  }

  // Pattern validation
  if (validation.pattern) {
    const pattern =
      typeof validation.pattern === 'string' ? new RegExp(validation.pattern) : validation.pattern

    if (!pattern.test(stringValue)) {
      return {
        isValid: false,
        message: validation.errorMessage || `${displayName} format is invalid`,
      }
    }
  }

  // Email validation
  if (validation.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(stringValue)) {
      return {
        isValid: false,
        message: validation.errorMessage || `${displayName} must be a valid email address`,
      }
    }
  }

  // URL validation
  if (validation.url) {
    try {
      new URL(stringValue)
    } catch {
      return {
        isValid: false,
        message: validation.errorMessage || `${displayName} must be a valid URL`,
      }
    }
  }

  // Port validation
  if (validation.port) {
    const port = numericValue
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return {
        isValid: false,
        message: validation.errorMessage || `${displayName} must be a valid port number (1-65535)`,
      }
    }
  }

  return { isValid: true }
}

/**
 * Generate React Hook Form validation rules from INodeProperty
 */
export function generateFormValidationRules(property: INodeProperty, editMode: boolean = false) {
  const { required, validation, displayName } = property

  const rules: any = {}

  // For sensitive fields in edit mode, allow empty values (existing encrypted data will be preserved)
  const isSensitive = isSensitiveField(property)
  const allowEmpty = editMode && isSensitive

  // Required validation
  if (required && !allowEmpty) {
    rules.required = `${displayName} is required`
  }

  // Additional validation rules
  if (validation) {
    // String length validation
    if (validation.minLength !== undefined) {
      rules.minLength = {
        value: validation.minLength,
        message:
          validation.errorMessage ||
          `${displayName} must be at least ${validation.minLength} characters`,
      }
    }

    if (validation.maxLength !== undefined) {
      rules.maxLength = {
        value: validation.maxLength,
        message:
          validation.errorMessage ||
          `${displayName} must be no more than ${validation.maxLength} characters`,
      }
    }

    // Numeric range validation
    if (validation.min !== undefined) {
      rules.min = {
        value: validation.min,
        message: validation.errorMessage || `${displayName} must be at least ${validation.min}`,
      }
    }

    if (validation.max !== undefined) {
      rules.max = {
        value: validation.max,
        message: validation.errorMessage || `${displayName} must be no more than ${validation.max}`,
      }
    }

    // Pattern validation
    if (validation.pattern) {
      rules.pattern = {
        value:
          typeof validation.pattern === 'string'
            ? new RegExp(validation.pattern)
            : validation.pattern,
        message: validation.errorMessage || `${displayName} format is invalid`,
      }
    }

    // Custom validation function
    if (validation.email || validation.url || validation.port) {
      rules.validate = (value: any) => {
        const result = validateFieldValue(value, property)
        return result.isValid || result.message
      }
    }
  }

  return rules
}

/**
 * Validate all credential data
 */
export function validateCredentialData(
  data: Record<string, any>,
  properties: INodeProperty[],
  editMode: boolean = false
): { isValid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  let isValid = true

  for (const property of properties) {
    // Skip notice and hidden fields
    if (property.type === 'notice' || property.type === 'hidden') {
      continue
    }

    const value = data[property.name]
    const result = validateFieldValue(value, property, editMode)

    if (!result.isValid) {
      errors[property.name] = result.message!
      isValid = false
    }
  }

  return { isValid, errors }
}
