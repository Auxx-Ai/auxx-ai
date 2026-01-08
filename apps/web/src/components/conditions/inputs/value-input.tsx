// apps/web/src/components/conditions/inputs/value-input.tsx

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

  const inputConfig = useMemo(() => {
    return resolveInputConfig(field.type as BaseType, condition.operator)
  }, [field.type, condition.operator])

  const renderVarEditor = (varType: BaseType, useField?: FieldDefinition) => {
    const targetField = useField || field

    // Build fieldOptions with enum and fieldReference embedded if applicable
    const fieldOptions: { enum?: Array<{ label: string; value: string }>; fieldReference?: string } = {}
    if (targetField.enumValues) {
      fieldOptions.enum = targetField.enumValues.map((enumValue) => {
        if (typeof enumValue === 'string') {
          return { label: enumValue, value: enumValue }
        }
        return { label: enumValue.label, value: enumValue.dbValue }
      })
    }
    if (targetField.fieldReference) {
      fieldOptions.fieldReference = targetField.fieldReference
    }

    const allowedTypes: (BaseType | string)[] = []

    if ((varType === BaseType.RELATION || varType === BaseType.REFERENCE) && targetField.targetTable) {
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
        fieldOptions={Object.keys(fieldOptions).length > 0 ? fieldOptions : undefined}
        allowedTypes={allowedTypes}
      />
    )
  }

  const customInput = useMemo(() => {
    if (config.customValueInputs && config.customValueInputs[field.type]) {
      return config.customValueInputs[field.type]
    }
    return null
  }, [config.customValueInputs, field.type])

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

  if (inputConfig.mode === InputMode.NONE) {
    return null
  }

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

  if (inputConfig.mode === InputMode.RELATION) {
    return renderVarEditor(BaseType.RELATION, field)
  }

  if (inputConfig.mode === InputMode.TEXT) {
    return renderVarEditor(BaseType.STRING, field)
  }

  if (inputConfig.mode === InputMode.SINGLE) {
    return renderVarEditor(inputConfig.varType || (field.type as BaseType), field)
  }

  return renderVarEditor(BaseType.ANY, field)
}

export default ValueInput
