// apps/web/src/components/workflow/ui/conditions/inputs/value-input.tsx

'use client'

import { useMemo } from 'react'
import { VarEditor } from '~/components/workflow/ui/input-editor/var-editor'
import { useConditionContext } from '../condition-context'
import { resolveInputConfig, InputMode } from '@auxx/lib/workflow-engine/client'
import MultipleValueInput from './multiple-value-input'
import type { ValueInputProps, FieldDefinition } from '../types'
import { BaseType } from '@auxx/lib/workflow-engine/types'

/**
 * Generic value input component that handles different field types and input modes
 * Now uses centralized input mode resolution
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

  // ✨ NEW: Resolve input configuration based on field type AND operator
  const inputConfig = useMemo(() => {
    return resolveInputConfig(field.type as BaseType, condition.operator)
  }, [field.type, condition.operator])

  // Helper function to render VarEditor
  const renderVarEditor = (varType: BaseType, useField?: FieldDefinition) => {
    const targetField = useField || field

    // Build fieldOptions with enum embedded if applicable
    // Handle both string[] and Array<{dbValue, label}> formats
    const fieldOptions = targetField.enumValues
      ? {
          enum: targetField.enumValues.map((enumValue) => {
            if (typeof enumValue === 'string') {
              return { label: enumValue, value: enumValue }
            }
            return { label: enumValue.label, value: enumValue.dbValue }
          }),
        }
      : undefined

    // Determine allowed types for type filtering
    const allowedTypes: (BaseType | string)[] = []

    // For RELATION and REFERENCE fields (both have targetTable from parseVariable)
    if ((varType === BaseType.RELATION || varType === BaseType.REFERENCE) && targetField.targetTable) {
      // Use target table directly from parsed variable
      // (targetField is the result of parseVariable which includes targetTable)
      allowedTypes.push(targetField.targetTable)
    } else if (varType !== BaseType.ANY) {
      allowedTypes.push(varType)
    }

    return (
      <VarEditor
        value={value}
        onChange={(newValue, isConstantMode) => onChange(newValue, isConstantMode)}
        onBlur={(newValue) => onChange(newValue)}
        nodeId={nodeId!}
        placeholder={
          placeholder ||
          inputConfig.placeholder ||
          `Enter ${targetField.label?.toLowerCase() || 'value'} or select variable`
        }
        disabled={disabled}
        varType={varType}
        className={className}
        allowConstant={config.allowConstantToggle}
        defaultIsConstantMode={condition.isConstant}
        fieldOptions={fieldOptions}
        fieldReference={targetField.fieldReference}
        allowedTypes={allowedTypes}
      />
    )
  }

  // Check if there's a custom value input for this field type
  const customInput = useMemo(() => {
    if (config.customValueInputs && config.customValueInputs[field.type]) {
      return config.customValueInputs[field.type]
    }
    return null
  }, [config.customValueInputs, field.type])

  // Use custom input if available
  if (customInput) {
    const CustomInput = customInput
    return (
      <CustomInput
        condition={condition}
        field={field}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        nodeId={nodeId}
      />
    )
  }

  // ===== NEW INPUT MODE HANDLING =====

  // Don't render input if mode is NONE
  if (inputConfig.mode === InputMode.NONE) {
    return null
  }

  // Handle MULTIPLE mode (for "is one of" operators)
  if (inputConfig.mode === InputMode.MULTIPLE) {
    return (
      <MultipleValueInput
        field={field}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={inputConfig.placeholder}
        className={className}
        nodeId={nodeId}
        config={config}
      />
    )
  }

  // Handle RELATION mode (relation picker)
  if (inputConfig.mode === InputMode.RELATION) {
    return renderVarEditor(BaseType.RELATION, field)
  }

  // Handle TEXT mode (plain text input for relation string operations)
  if (inputConfig.mode === InputMode.TEXT) {
    return renderVarEditor(BaseType.STRING, field)
  }

  // Handle SINGLE mode (default for most field types)
  if (inputConfig.mode === InputMode.SINGLE) {
    return renderVarEditor(inputConfig.varType || (field.type as BaseType), field)
  }

  // Fallback (should never reach here)
  return renderVarEditor(BaseType.ANY, field)
}

export default ValueInput
