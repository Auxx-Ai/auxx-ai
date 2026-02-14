// apps/web/src/components/conditions/components/variable-field-selector.tsx

'use client'

import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import VariableInput from '~/components/workflow/ui/variables/variable-input'
import { VariablePicker } from '~/components/workflow/ui/variables/variable-picker'
import type { FieldSelectorProps } from '../types'

/**
 * Props for VariableFieldSelector, extends base FieldSelectorProps with required nodeId
 */
export interface VariableFieldSelectorProps extends FieldSelectorProps {
  nodeId: string
  /** Custom render function for trigger - when provided, uses VariablePicker directly */
  renderTrigger?: (props: { isOpen: boolean; onClick: () => void }) => React.ReactNode
}

/**
 * Field selector for variable-based systems (like if-else nodes)
 * Uses VariableInput to allow selecting workflow variables
 * When renderTrigger is provided, uses VariablePicker directly for custom trigger support
 */
const VariableFieldSelector = ({
  value,
  onChange,
  disabled,
  placeholder = 'Select field',
  className,
  popoverWidth = 400,
  popoverHeight = 500,
  nodeId,
  renderTrigger,
}: VariableFieldSelectorProps) => {
  /** Handle variable selection and call onChange with variable id */
  const handleVariableSelect = (variable: UnifiedVariable) => {
    onChange(variable.id)
  }

  // If custom trigger provided, use VariablePicker directly
  if (renderTrigger) {
    return (
      <VariablePicker
        nodeId={nodeId}
        value={value}
        onVariableSelect={handleVariableSelect}
        renderTrigger={renderTrigger}
        popoverWidth={popoverWidth}
        popoverHeight={popoverHeight}
        placeholder={placeholder}
      />
    )
  }

  // Default: use VariableInput with built-in trigger
  return (
    <VariableInput
      variableId={value}
      onVariableSelect={handleVariableSelect}
      disabled={disabled}
      nodeId={nodeId}
      placeholder={placeholder}
      className={className}
      popoverWidth={popoverWidth}
      popoverHeight={popoverHeight}
    />
  )
}

export default VariableFieldSelector
