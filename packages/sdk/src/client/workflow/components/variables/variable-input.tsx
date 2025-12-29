// packages/sdk/src/client/workflow/components/variables/variable-input.tsx

import type React from 'react'
import type { BaseType } from '../../../../root/workflow/types.js'
import type { UnifiedVariable } from '../../hooks/use-variable.js'

/**
 * Props for VariableInput component
 */
export interface VariableInputProps {
  /** Current variable selection (variable ID or fullPath) */
  variableId: string

  /** Current node ID (for upstream validation) */
  nodeId: string

  /** Callback when variable selected */
  onVariableSelect?: (variable: UnifiedVariable) => void

  /** Type filtering (optional) */
  allowedTypes?: BaseType[]

  /** UI customization */
  placeholder?: string
  disabled?: boolean
  className?: string
  popoverWidth?: number
  popoverHeight?: number
  showFavorites?: boolean
  showRecent?: boolean

  /** Additional props */
  [key: string]: any
}

/**
 * Variable input component for selecting workflow variables.
 *
 * This component provides variable selection with type validation and upstream availability checking.
 *
 * @example
 * ```typescript
 * import { VariableInput, BaseType } from '@auxx/sdk/client'
 *
 * export function CustomPanel() {
 *   const { nodeId, data, updateData } = useWorkflowContext()
 *
 *   return (
 *     <WorkflowPanel>
 *       <Section>
 *         <Label>Customer Email</Label>
 *         <VariableInput
 *           variableId={data.customerEmail || ''}
 *           nodeId={nodeId}
 *           onVariableSelect={(variable) => {
 *             updateData({
 *               customerEmail: `{{${variable.fullPath}}}`
 *             })
 *           }}
 *           allowedTypes={[BaseType.STRING, BaseType.EMAIL]}
 *           placeholder="Select customer email..."
 *         />
 *       </Section>
 *     </WorkflowPanel>
 *   )
 * }
 * ```
 */
export const VariableInput: React.FC<VariableInputProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowvariableinput', {
    ...props,
    component: 'VariableInputInternal',
  })
}
