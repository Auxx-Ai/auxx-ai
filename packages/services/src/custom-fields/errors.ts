// packages/services/src/custom-fields/errors.ts

/**
 * Field not found error
 */
export type CustomFieldNotFoundError = {
  code: 'CUSTOM_FIELD_NOT_FOUND'
  message: string
  fieldId?: string
}

/**
 * Entity not found error
 */
export type EntityNotFoundError = {
  code: 'ENTITY_NOT_FOUND'
  message: string
  entityId?: string
  entityType?: string
}

/**
 * Field value validation error
 */
export type FieldValueValidationError = {
  code: 'FIELD_VALUE_VALIDATION_ERROR'
  message: string
  fieldId?: string
  fieldName?: string
}

/**
 * Access denied error
 */
export type AccessDeniedError = {
  code: 'ACCESS_DENIED'
  message: string
}

/**
 * All custom field specific errors
 */
export type CustomFieldError =
  | CustomFieldNotFoundError
  | EntityNotFoundError
  | FieldValueValidationError
  | AccessDeniedError
