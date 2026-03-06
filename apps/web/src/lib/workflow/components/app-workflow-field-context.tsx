// apps/web/src/lib/workflow/components/app-workflow-field-context.tsx

'use client'

import { createContext, useContext } from 'react'
import type { WorkflowBlock } from '../types'

/**
 * Context for app workflow field state.
 * Provides field-level access to node data, field mode tracking, and schema metadata
 * for VarEditor-backed input components in extension app workflow panels.
 */
export interface AppWorkflowFieldContextValue {
  /** Current node ID */
  nodeId: string
  /** Current node data (flat key-value pairs) */
  nodeData: Record<string, any>
  /** Update a field value. isConstantMode tracks whether the field is in constant (true) or variable (false) mode. */
  handleFieldChange: (fieldKey: string, value: any, isConstantMode: boolean) => void
  /** Get field mode: true = constant, false = variable. Defaults to true if not set. */
  getFieldMode: (fieldKey: string) => boolean
  /** Block schema with input/output field definitions */
  schema: WorkflowBlock['schema'] | null
  /** Whether this node is a trigger node (no upstream variables available) */
  isTrigger: boolean
  /** Raw setter for atomic multi-field updates (used by ArrayInputInternal) */
  setInputs?: (data: Record<string, any>) => void
}

const AppWorkflowFieldContext = createContext<AppWorkflowFieldContextValue | null>(null)

/**
 * Hook to consume the app workflow field context.
 * Must be used within an AppWorkflowFieldContext.Provider.
 */
export function useAppWorkflowFieldContext(): AppWorkflowFieldContextValue {
  const ctx = useContext(AppWorkflowFieldContext)
  if (!ctx) {
    throw new Error(
      'useAppWorkflowFieldContext must be used within AppWorkflowFieldContext.Provider'
    )
  }
  return ctx
}

export { AppWorkflowFieldContext }
