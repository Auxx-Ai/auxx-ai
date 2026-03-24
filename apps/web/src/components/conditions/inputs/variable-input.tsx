// apps/web/src/components/conditions/inputs/variable-input.tsx

'use client'

import { BaseType, InputMode, resolveInputConfig } from '@auxx/lib/workflow-engine/client'
import { useMemo } from 'react'
import { VarEditor } from '~/components/workflow/ui/input-editor/var-editor'
import { VarEditorArray } from '~/components/workflow/ui/input-editor/var-editor-array'
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
  /** Callback when value changes, with optional constant mode flag and metadata */
  onChange: (value: unknown, isConstantMode?: boolean, metadata?: Record<string, any>) => void
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
  const opts: {
    enum?: Array<{ label: string; value: string }>
    fieldReference?: string
    relatedEntityDefinitionId?: string
    actor?: { target?: string; multiple?: boolean }
  } = {}
  if (field.options?.options?.length) {
    opts.enum = field.options.options
  }
  if (field.fieldReference) {
    opts.fieldReference = field.fieldReference
  }
  if (field.targetEntityDefinitionId) {
    opts.relatedEntityDefinitionId = field.targetEntityDefinitionId
  }
  if (field.options?.actor) {
    opts.actor = field.options.actor
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
    const config = resolveInputConfig(field.type as BaseType, condition.operator)
    console.log('[VariableInput] resolveInputConfig', {
      fieldType: field.type,
      fieldLabel: field.label,
      operator: condition.operator,
      result: config,
    })
    return config
  }, [field.type, field.label, condition.operator])

  // Pre-compute fieldOptions
  const fieldOptions = useMemo(() => {
    const opts = buildFieldOptions(field)
    console.log('[VariableInput] buildFieldOptions', {
      fieldLabel: field.label,
      fieldType: field.type,
      hasActor: !!field.options?.actor,
      hasFieldReference: !!field.fieldReference,
      result: opts,
    })
    return opts
  }, [field])

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
    const arrayValue = Array.isArray(value) ? value.map(String) : value ? [String(value)] : []
    const valueModes = condition.metadata?.valueModes as boolean[] | undefined

    return (
      <VarEditorArray
        value={arrayValue}
        onChange={(values, modes) => {
          onChange(values, undefined, { valueModes: modes })
        }}
        modes={valueModes}
        varType={varType}
        nodeId={nodeId}
        disabled={disabled}
        allowConstant={config.allowConstantToggle}
        placeholder={placeholderText}
        placeholderConstant={`Enter ${field.label?.toLowerCase() || 'value'}`}
        fieldOptions={fieldOptions}
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
