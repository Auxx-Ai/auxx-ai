// apps/web/src/components/conditions/inputs/multiple-value-input.tsx

'use client'

import { useCallback, useMemo } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Plus, Trash2 } from 'lucide-react'
import { VarEditor } from '~/components/workflow/ui/input-editor/var-editor'
import { cn } from '@auxx/ui/lib/utils'
import type { FieldDefinition, ConditionSystemConfig } from '../types'
import type { BaseType } from '@auxx/lib/workflow-engine/types'

interface MultipleValueInputProps {
  field: FieldDefinition
  value: any
  onChange: (value: any, isConstantMode?: boolean) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  nodeId?: string
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
    (index: number, newValue: any, isConstantMode?: boolean) => {
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
            fieldOptions={(() => {
              const opts: { enum?: Array<{ label: string; value: string }>; fieldReference?: string } = {}
              if (field.enumValues) {
                opts.enum = field.enumValues.map((enumValue) => {
                  if (typeof enumValue === 'string') {
                    return { label: enumValue, value: enumValue }
                  }
                  return { label: enumValue.label, value: enumValue.dbValue }
                })
              }
              if (field.fieldReference) {
                opts.fieldReference = field.fieldReference
              }
              return Object.keys(opts).length > 0 ? opts : undefined
            })()}
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
