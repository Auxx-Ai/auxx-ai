// apps/web/src/components/conditions/inputs/variable-input.tsx

'use client'

import { BaseType, InputMode, resolveInputConfig } from '@auxx/lib/workflow-engine/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { VarEditor } from '~/components/workflow/ui/input-editor/var-editor'
import { useConditionContext } from '../condition-context'
import type { Condition, FieldDefinition } from '../types'

/**
 * Props for VariableInput component
 */
interface VariableInputProps {
  /** The condition being edited */
  condition: Condition
  /** Field definition with type and options */
  field: FieldDefinition
  /** Current value */
  value: unknown
  /** Node ID for variable context */
  nodeId: string
  /** Callback when value changes, with optional constant mode flag */
  onChange: (value: unknown, isConstantMode?: boolean) => void
  /** Whether input is disabled */
  disabled?: boolean
  /** Custom placeholder */
  placeholder?: string
  /** Additional class names */
  className?: string
}

/**
 * Builds fieldOptions object for VarEditor from field definition
 */
function buildFieldOptions(field: FieldDefinition) {
  const opts: { enum?: Array<{ label: string; value: string }>; fieldReference?: string } = {}
  if (field.options?.options?.length) {
    opts.enum = field.options.options
  }
  if (field.fieldReference) {
    opts.fieldReference = field.fieldReference
  }
  return Object.keys(opts).length > 0 ? opts : undefined
}

/**
 * Builds allowedTypes array for VarEditor variable filtering
 */
function buildAllowedTypes(varType: BaseType, field: FieldDefinition): (BaseType | string)[] {
  const allowedTypes: (BaseType | string)[] = []
  if (
    (varType === BaseType.RELATION || varType === BaseType.REFERENCE) &&
    field.targetEntityDefinitionId
  ) {
    allowedTypes.push(field.targetEntityDefinitionId)
  } else if (varType !== BaseType.ANY) {
    allowedTypes.push(varType)
  }
  return allowedTypes
}

/**
 * Input component for variable-based conditions.
 * Uses VarEditor with full variable picker support.
 * Handles both single and multiple value modes.
 */
export function VariableInput({
  condition,
  field,
  value,
  nodeId,
  onChange,
  disabled = false,
  placeholder,
  className,
}: VariableInputProps) {
  const { config } = useConditionContext()

  // Resolve input configuration based on field type and operator
  const inputConfig = useMemo(() => {
    return resolveInputConfig(field.type as BaseType, condition.operator)
  }, [field.type, condition.operator])

  // Pre-compute fieldOptions
  const fieldOptions = useMemo(() => buildFieldOptions(field), [field])

  // Skip rendering if no input needed
  if (inputConfig.mode === InputMode.NONE) {
    return null
  }

  // Determine the variable type
  const varType = inputConfig.varType ?? (field.type as BaseType) ?? BaseType.STRING
  const allowedTypes = buildAllowedTypes(varType, field)

  // Placeholder text
  const placeholderText =
    placeholder ||
    inputConfig.placeholder ||
    `Enter ${field.label?.toLowerCase() || 'value'} or select variable`

  // Multiple value mode for "in" / "not in" operators
  if (inputConfig.mode === InputMode.MULTIPLE) {
    return (
      <MultipleVarEditor
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholderText}
        className={className}
        nodeId={nodeId}
        varType={varType}
        allowedTypes={allowedTypes}
        fieldOptions={fieldOptions}
        allowConstant={config.allowConstantToggle}
      />
    )
  }

  // Single value mode (SINGLE, RELATION, TEXT, or fallback)
  let effectiveVarType = varType
  if (inputConfig.mode === InputMode.RELATION) {
    effectiveVarType = BaseType.RELATION
  } else if (inputConfig.mode === InputMode.TEXT) {
    effectiveVarType = BaseType.STRING
  }

  return (
    <VarEditor
      value={value as string}
      onChange={(newValue, isConstantMode) => onChange(newValue, isConstantMode)}
      onBlur={(newValue) => onChange(newValue)}
      nodeId={nodeId}
      placeholder={placeholderText}
      disabled={disabled}
      varType={effectiveVarType}
      className={className}
      allowConstant={config.allowConstantToggle}
      defaultIsConstantMode={condition.isConstant}
      fieldOptions={fieldOptions}
      allowedTypes={allowedTypes}
    />
  )
}

/**
 * Props for MultipleVarEditor sub-component
 */
interface MultipleVarEditorProps {
  value: unknown
  onChange: (value: unknown, isConstantMode?: boolean) => void
  disabled: boolean
  placeholder: string
  className?: string
  nodeId: string
  varType: BaseType
  allowedTypes: (BaseType | string)[]
  fieldOptions?: { enum?: Array<{ label: string; value: string }>; fieldReference?: string }
  allowConstant?: boolean
}

/**
 * Renders multiple VarEditor instances for "in" / "not in" operators
 */
function MultipleVarEditor({
  value,
  onChange,
  disabled,
  placeholder,
  className,
  nodeId,
  varType,
  allowedTypes,
  fieldOptions,
  allowConstant,
}: MultipleVarEditorProps) {
  // Normalize value to array
  const values = useMemo(() => {
    if (Array.isArray(value)) {
      return value.length > 0 ? value : ['']
    }
    if (typeof value === 'string' && value) return [value]
    return ['']
  }, [value])

  const handleAddValue = useCallback(() => {
    onChange([...values, ''])
  }, [values, onChange])

  const handleUpdateValue = useCallback(
    (index: number, newValue: unknown, isConstantMode?: boolean) => {
      const updated = [...values]
      updated[index] = newValue
      onChange(updated, isConstantMode)
    },
    [values, onChange]
  )

  const handleRemoveValue = useCallback(
    (index: number) => {
      const updated = values.filter((_, i) => i !== index)
      onChange(updated)
    },
    [values, onChange]
  )

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {values.map((val, index) => (
        <div key={index} className='flex items-center gap-1'>
          <VarEditor
            value={val}
            onChange={(newValue, isConstantMode) =>
              handleUpdateValue(index, newValue, isConstantMode)
            }
            onBlur={(newValue) => handleUpdateValue(index, newValue)}
            nodeId={nodeId}
            placeholder={placeholder || `Value ${index + 1}`}
            disabled={disabled}
            varType={varType}
            className='flex-1'
            allowConstant={allowConstant}
            defaultIsConstantMode={true}
            fieldOptions={fieldOptions}
            allowedTypes={allowedTypes}
          />
          <Button
            variant='destructive-hover'
            className='rounded-lg'
            size='icon-xs'
            onClick={() => handleRemoveValue(index)}
            disabled={disabled || values.length === 1}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        variant='outline'
        size='xs'
        onClick={handleAddValue}
        disabled={disabled}
        className='w-fit'>
        <Plus />
        Add Value
      </Button>
    </div>
  )
}
