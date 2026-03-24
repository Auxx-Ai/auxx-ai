// apps/web/src/components/conditions/inputs/value-input.tsx

'use client'

import { useConditionContext } from '../condition-context'
import type { ValueInputProps } from '../types'
import { ResourceInput } from './resource-input'
import { VariableInput } from './variable-input'

/**
 * Router component that delegates to ResourceInput or VariableInput
 * based on the conditions configuration mode.
 */
const ValueInput = ({
  condition,
  field,
  value,
  onChange,
  disabled,
  placeholder,
  className,
  nodeId,
}: ValueInputProps) => {
  const { config } = useConditionContext()

  console.log('[ValueInput] routing', {
    mode: config.mode,
    nodeId,
    fieldType: field.type,
    fieldLabel: field.label,
    operator: condition.operator,
  })

  // Resource mode - use FieldInputAdapter directly
  if (config.mode === 'resource' && !nodeId) {
    return (
      <ResourceInput
        condition={condition}
        field={field}
        value={value}
        onChange={(val) => onChange(val, true)} // Resource is always constant mode
        disabled={disabled}
        placeholder={placeholder}
        triggerProps={className ? { className } : undefined}
      />
    )
  }

  // Variable mode - use VarEditor with full variable support
  if (!nodeId) {
    console.warn('ValueInput: nodeId required for variable mode')
    return null
  }

  return (
    <VariableInput
      condition={condition}
      field={field}
      value={value}
      nodeId={nodeId}
      onChange={(val, isConstantMode, metadata) => onChange(val, isConstantMode, metadata)}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
    />
  )
}

export default ValueInput
