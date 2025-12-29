// apps/web/src/components/workflow/nodes/core/crud/use-crud-validation.ts

import { useState, useCallback, useMemo, useEffect } from 'react'
import { CrudNodeData, ValidationResult } from './types'
import { validateCrudNodeConfig } from './validation'

/**
 * Hook for validating CRUD node configuration
 * @param nodeData The current node data
 * @returns Object containing validation state and functions
 */
export function useCrudValidation(nodeData: CrudNodeData) {
  const [validationResult, setValidationResult] = useState<ValidationResult>({
    isValid: true,
    errors: [],
  })
  const [showValidation, setShowValidation] = useState(false)

  // Memoize validation to avoid unnecessary re-runs
  const currentValidation = useMemo(() => {
    return validateCrudNodeConfig(nodeData)
  }, [nodeData])

  // Update validation state when node data changes
  useEffect(() => {
    setValidationResult(currentValidation)
  }, [currentValidation])

  // Function to manually trigger validation (useful for form submission)
  const validate = useCallback(() => {
    const result = validateCrudNodeConfig(nodeData)
    setValidationResult(result)
    setShowValidation(true)
    return result
  }, [nodeData])

  // Function to get errors for a specific field
  const getFieldErrors = useCallback(
    (fieldPath: string) => {
      return validationResult.errors.filter((error) => error.field === fieldPath)
    },
    [validationResult.errors]
  )

  // Function to check if a specific field has errors
  const hasFieldError = useCallback(
    (fieldPath: string) => {
      return getFieldErrors(fieldPath).length > 0
    },
    [getFieldErrors]
  )

  // Function to get the first error message for a field
  const getFieldErrorMessage = useCallback(
    (fieldPath: string) => {
      const errors = getFieldErrors(fieldPath)
      return errors.length > 0 ? errors[0].message : undefined
    },
    [getFieldErrors]
  )

  // Function to check if a field has errors of a specific type
  const hasFieldErrorOfType = useCallback(
    (fieldPath: string, type: 'error' | 'warning') => {
      return getFieldErrors(fieldPath).some((error) => (error.type || 'error') === type)
    },
    [getFieldErrors]
  )

  // Get all errors grouped by type
  const errorsByType = useMemo(() => {
    const errors = validationResult.errors.filter((e) => (e.type || 'error') === 'error')
    const warnings = validationResult.errors.filter((e) => e.type === 'warning')
    return { errors, warnings }
  }, [validationResult.errors])

  return {
    validationResult,
    showValidation,
    setShowValidation,
    validate,
    getFieldErrors,
    hasFieldError,
    getFieldErrorMessage,
    hasFieldErrorOfType,
    errorsByType,
    isValid: validationResult.isValid,
    hasErrors: errorsByType.errors.length > 0,
    hasWarnings: errorsByType.warnings.length > 0,
  }
}
