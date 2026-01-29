// apps/web/src/components/conditions/components/condition-badge.tsx

'use client'

import { useCallback, useState, useEffect, useMemo } from 'react'
import { X } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { useConditionContext } from '../condition-context'
import ConditionOperator from './condition-operator'
import ResourceFieldSelector from './resource-field-selector'
import { ResourceInput } from '../inputs/resource-input'
import { resolveFieldInputConfig, FieldInputMode } from '@auxx/lib/conditions/client'
import { operatorRequiresValue } from '../types'
import type { ConditionItemProps, Operator } from '../types'

/**
 * Extended props for ConditionBadge with searchbar support
 */
interface ConditionBadgeProps extends ConditionItemProps {
  /** Whether this badge is highlighted via keyboard navigation */
  isHighlighted?: boolean
}

/**
 * ConditionBadge - single-row inline editable condition component.
 * Layout: [Field ▾] │ [Operator ▾] │ [Value Input] │ [X]
 * All in one compact row for use in searchbar and other inline contexts.
 */
export const ConditionBadge = ({
  condition,
  groupId,
  showRemoveButton = true,
  compactMode = false,
  isHighlighted = false,
  className,
  onUpdate,
  onRemove,
}: ConditionBadgeProps) => {
  const [isHovered, setIsHovered] = useState(false)
  const [valuePickerOpen, setValuePickerOpen] = useState(false)
  const {
    config,
    readOnly,
    updateCondition,
    removeCondition,
    getFieldDefinition,
    getAvailableFields,
  } = useConditionContext()

  const fieldDef = getFieldDefinition(condition.fieldId)

  // Resolve input configuration based on field type and operator
  const inputConfig = useMemo(() => {
    return resolveFieldInputConfig(fieldDef?.fieldType ?? 'TEXT', condition.operator)
  }, [fieldDef?.fieldType, condition.operator])

  // Whether this condition requires a value input
  const hasInput = inputConfig.mode !== FieldInputMode.NONE

  // Auto-open value picker when condition is created with undefined value
  // Only auto-open if the operator requires a value input
  useEffect(() => {
    if (condition.value === undefined && !valuePickerOpen && hasInput) {
      // Small delay to ensure component is mounted
      const timer = setTimeout(() => {
        setValuePickerOpen(true)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [condition.id, hasInput]) // Only run on initial mount (using condition.id as dependency)

  const handleUpdate = useCallback(
    (updates: Partial<typeof condition>) => {
      if (onUpdate) {
        onUpdate(updates)
      } else {
        updateCondition(condition.id, updates, groupId)
      }
    },
    [condition.id, groupId, onUpdate, updateCondition]
  )

  const handleRemove = useCallback(() => {
    if (onRemove) {
      onRemove()
    } else {
      removeCondition(condition.id, groupId)
    }
  }, [condition.id, groupId, onRemove, removeCondition])

  const handleFieldChange = useCallback(
    (fieldId: string) => {
      const newFieldDef = getFieldDefinition(fieldId)
      if (!newFieldDef) return

      const firstOperator = newFieldDef.operators?.[0] || 'equals'
      handleUpdate({
        fieldId,
        operator: firstOperator,
        value: '',
        variableId: config.mode === 'variable' ? fieldId : condition.variableId,
      })
    },
    [getFieldDefinition, handleUpdate, config.mode, condition.variableId]
  )

  const handleOperatorChange = useCallback(
    (operator: Operator) => {
      const oldOperator = condition.operator
      let newValue = condition.value

      if (
        ['isEmpty', 'isNotEmpty', 'empty', 'not empty', 'exists', 'not exists'].includes(operator)
      ) {
        newValue = undefined
      } else if (['in', 'not in'].includes(oldOperator) && !['in', 'not in'].includes(operator)) {
        if (Array.isArray(newValue)) {
          newValue = newValue.length > 0 && newValue[0] ? newValue[0] : undefined
        }
      } else if (!['in', 'not in'].includes(oldOperator) && ['in', 'not in'].includes(operator)) {
        if (!Array.isArray(newValue)) {
          newValue = newValue ? [newValue] : []
        }
      }

      handleUpdate({ operator, value: newValue })
    },
    [condition.operator, condition.value, handleUpdate]
  )

  const handleValueChange = useCallback(
    (value: any, isConstantMode?: boolean) => {
      const updates: any = { value }
      if (isConstantMode !== undefined) {
        updates.isConstant = isConstantMode
      }
      handleUpdate(updates)
    },
    [handleUpdate]
  )

  console.log('condition', condition)
  return (
    <div
      data-slot="condition-badge"
      className={cn(
        'flex flex-row h-7 items-center rounded-xl bg-primary-200/30 border shrink-0',
        isHighlighted && 'ring-2 ring-info',
        isHovered && 'bg-destructive/10 border-destructive/20',
        className
      )}>
      {/* Field Selector */}
      <ResourceFieldSelector
        value={condition.fieldId}
        onChange={handleFieldChange}
        disabled={readOnly}
        placeholder="Field"
        availableFields={getAvailableFields()}
        renderTrigger={() => (
          <Button
            variant="transparent"
            className={cn(
              'h-7 hover:bg-primary-200/50 px-1.5 text-xs rounded-r-none border-r',
              isHovered && 'border-destructive/20'
            )}>
            {fieldDef?.label ?? 'Field'}
          </Button>
        )}
      />

      {/* Operator Selector */}
      <ConditionOperator
        fieldId={condition.fieldId}
        value={condition.operator}
        onChange={handleOperatorChange}
        disabled={!condition.fieldId || readOnly}
        className={cn(
          'h-7 hover:bg-primary-200/50 px-1.5 text-xs rounded-none border-r',
          isHovered && 'border-destructive/20'
        )}
      />

      {/* Value Input */}
      <ResourceInput
        condition={condition}
        field={fieldDef}
        value={condition.value}
        onChange={handleValueChange}
        disabled={readOnly}
        className="text-xs"
        triggerProps={{
          size: 'sm',
          className: 'min-h-7 h-7 ps-1 pe-1 mx-0',
          hideIcon: true,
        }}
        open={valuePickerOpen}
        onOpenChange={setValuePickerOpen}
      />

      {/* Remove Button */}
      {showRemoveButton && !readOnly && (
        <div
          onClick={handleRemove}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={cn(
            'h-7 w-7 cursor-pointer rounded-r-xl flex items-center shrink-0 justify-center ',
            'text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/20',
            hasInput ? 'border-l' : ''
          )}
          aria-label="Remove condition">
          <X className="size-3.5 shrink-0" />
        </div>
      )}
    </div>
  )
}
