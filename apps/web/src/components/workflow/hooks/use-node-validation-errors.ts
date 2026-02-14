// apps/web/src/components/workflow/hooks/use-node-validation-errors.ts

import { useMemo } from 'react'
import { useDebounce } from '~/hooks/use-debounced-value'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import type { BaseNodeData } from '../types'
import { useNodeConnections } from './use-node-connections'

interface UseNodeValidationProps {
  nodeId: string
  data: BaseNodeData
  enabled?: boolean
}

interface ValidationIssue {
  field: string
  message: string
  type: 'warning' | 'error'
}

interface ValidationState {
  isValidating: boolean
  issues: ValidationIssue[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  hasIssues: boolean
  hasErrors: boolean
  hasWarnings: boolean
}

/**
 * Hook for validating node data with debouncing
 * Combines schema validation with connection validation
 */
export function useNodeValidationErrors({
  nodeId,
  data,
  enabled = true,
}: UseNodeValidationProps): ValidationState {
  const { needsOutgoingConnection } = useNodeConnections(nodeId, data.type)

  // Debounce the data to avoid excessive validation
  const debouncedData = useDebounce(data, 300)

  const validation = useMemo(() => {
    if (!enabled) {
      return {
        isValidating: false,
        issues: [],
        errors: [],
        warnings: [],
        hasIssues: false,
        hasErrors: false,
        hasWarnings: false,
      }
    }

    const issues: ValidationIssue[] = []

    // Check connection requirement (as warning)
    if (needsOutgoingConnection) {
      issues.push({
        field: '_connection',
        message: 'Node needs outgoing connection',
        type: 'warning',
      })
    }

    // Run schema validator
    const nodeDefinition = unifiedNodeRegistry.getDefinition(data.type)
    if (nodeDefinition?.validator) {
      const validationResult = nodeDefinition.validator(debouncedData)
      if (!validationResult.isValid) {
        // Add validation errors, defaulting type to 'error' if not specified
        validationResult.errors.forEach((error) => {
          issues.push({ field: error.field, message: error.message, type: error.type || 'error' })
        })
      }
    }

    // Separate errors and warnings
    const errors = issues.filter((i) => i.type === 'error')
    const warnings = issues.filter((i) => i.type === 'warning')

    return {
      isValidating: false,
      issues,
      errors,
      warnings,
      hasIssues: issues.length > 0,
      hasErrors: errors.length > 0,
      hasWarnings: warnings.length > 0,
    }
  }, [debouncedData, needsOutgoingConnection, enabled, data.type])

  return validation
}
