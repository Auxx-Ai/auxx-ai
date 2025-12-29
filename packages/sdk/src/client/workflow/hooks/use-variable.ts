// packages/sdk/src/client/workflow/hooks/use-variable.ts

'use client'

import { createContext, useContext } from 'react'
import type { BaseType } from '../../../root/workflow/types.js'

/**
 * Unified variable definition
 */
export interface UnifiedVariable {
  /** Variable ID */
  id: string
  /** Variable path (e.g., "output") */
  path: string
  /** Full variable path (e.g., "node-123.output") */
  fullPath: string
  /** Display label */
  label: string
  /** Variable type */
  type: BaseType
  /** Variable category */
  category: 'node' | 'environment' | 'system' | 'loop'
  /** Description */
  description?: string
}

/**
 * Variable store context data
 */
export interface VariableStoreContextData {
  /**
   * Get a variable by ID
   */
  getVariable: (variableId: string, nodeId?: string) => UnifiedVariable | undefined

  /**
   * Check if a variable is valid/available for a given node
   */
  isVariableAvailable: (variableId: string, nodeId: string) => boolean

  /**
   * Get all available variables for a node
   */
  getAvailableVariables: (nodeId: string) => UnifiedVariable[]
}

/**
 * React context for variable store
 */
export const VariableStoreContext = createContext<VariableStoreContextData | null>(null)

/**
 * Validate and retrieve variable metadata.
 *
 * This hook provides access to variable information and validation.
 * It checks if a variable exists and whether it's available for a specific node.
 *
 * @param variableId - The ID of the variable to retrieve
 * @param nodeId - The current node ID for availability checking
 *
 * @example
 * ```typescript
 * export function CustomPanel() {
 *   const { nodeId, data } = useWorkflowContext()
 *   const { variable, isValid } = useVariable(data.selectedVar, nodeId)
 *
 *   return (
 *     <WorkflowPanel>
 *       {!isValid && data.selectedVar && (
 *         <Alert variant="warning">
 *           Selected variable is not available upstream
 *         </Alert>
 *       )}
 *       {/* ... *\/}
 *     </WorkflowPanel>
 *   )
 * }
 * ```
 */
export function useVariable(
  variableId: string,
  nodeId: string
): {
  variable: UnifiedVariable | null
  isValid: boolean
} {
  const context = useContext(VariableStoreContext)

  if (!context) {
    // Fallback when used outside of a proper context
    // This might happen in development or testing
    return {
      variable: null,
      isValid: false,
    }
  }

  const variable = context.getVariable(variableId, nodeId)
  const isValid = variable ? context.isVariableAvailable(variableId, nodeId) : false

  return {
    variable: variable || null,
    isValid,
  }
}
