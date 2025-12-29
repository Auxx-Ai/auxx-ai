// apps/web/src/components/workflow/ui/conditions/inputs/multiple-value-input.tsx

'use client'

import { useCallback, useMemo } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Plus, Trash2, X } from 'lucide-react'
import { VarEditor } from '~/components/workflow/ui/input-editor/var-editor'
import { cn } from '@auxx/ui/lib/utils'
import type { FieldDefinition, ConditionSystemConfig } from '../types'
import type { BaseType } from '@auxx/lib/workflow-engine/types'

/**
 * Component for handling "is one of" / "is not one of" operators
 * Allows adding/removing multiple values
 */
interface MultipleValueInputProps {
  /** Field definition for the condition */
  field: FieldDefinition

  /** Current value (should be array or parseable to array) */
  value: any

  /** Callback when values change */
  onChange: (value: any, isConstantMode?: boolean) => void

  /** Whether input is disabled */
  disabled?: boolean

  /** Placeholder text */
  placeholder?: string

  /** Additional CSS classes */
  className?: string

  /** Node ID for variable resolution */
  nodeId?: string

  /** Condition system configuration */
  config: ConditionSystemConfig
}

/**
 * MultipleValueInput - Renders multiple value inputs for "in" and "not in" operators
 */
const MultipleValueInput: React.FC<MultipleValueInputProps> = ({
  field,
  value,
  onChange,
  disabled,
  placeholder,
  className,
  nodeId,
  config,
}) => {
  // Parse value as array, ensuring at least one empty row
  const values = useMemo(() => {
    if (Array.isArray(value)) {
      // If array is empty, ensure at least one empty row
      return value.length > 0 ? value : ['']
    }
    if (typeof value === 'string' && value) return [value]
    // Default: ensure at least one empty input row
    return ['']
  }, [value])

  // Add new empty value to the list
  const handleAddValue = useCallback(() => {
    onChange([...values, ''])
  }, [values, onChange])

  // Update a specific value in the list
  const handleUpdateValue = useCallback(
    (index: number, newValue: any, isConstantMode?: boolean) => {
      const updated = [...values]
      updated[index] = newValue
      onChange(updated, isConstantMode)
    },
    [values, onChange]
  )

  // Remove a value from the list
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
        <div key={index} className="flex items-center gap-1">
          <VarEditor
            value={val}
            onChange={(newValue, isConstantMode) => handleUpdateValue(index, newValue, isConstantMode)}
            onBlur={(newValue) => handleUpdateValue(index, newValue)}
            nodeId={nodeId!}
            placeholder={placeholder || `Value ${index + 1}`}
            disabled={disabled}
            varType={field.type as BaseType}
            className="flex-1"
            allowConstant={config.allowConstantToggle}
            defaultIsConstantMode={true}
            fieldOptions={
              field.enumValues
                ? {
                    enum: field.enumValues.map((enumValue) => {
                      if (typeof enumValue === 'string') {
                        return { label: enumValue, value: enumValue }
                      }
                      return { label: enumValue.label, value: enumValue.dbValue }
                    }),
                  }
                : undefined
            }
            fieldReference={field.fieldReference}
          />
          <Button
            variant="destructive-hover"
            className="rounded-lg"
            size="icon-xs"
            onClick={() => handleRemoveValue(index)}
            disabled={disabled || values.length === 1}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="xs"
        onClick={handleAddValue}
        disabled={disabled}
        className="w-fit">
        <Plus />
        Add Value
      </Button>
    </div>
  )
}

export default MultipleValueInput
