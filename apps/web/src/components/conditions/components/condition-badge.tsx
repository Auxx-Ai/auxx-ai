// apps/web/src/components/conditions/components/condition-badge.tsx

'use client'

import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { useConditionContext } from '../condition-context'
import ConditionOperator from './condition-operator'
import ResourceFieldSelector from './resource-field-selector'
import { ResourceInput } from '../inputs/resource-input'
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
  const {
    config,
    readOnly,
    updateCondition,
    removeCondition,
    getFieldDefinition,
    getAvailableFields,
  } = useConditionContext()

  const fieldDef = getFieldDefinition(condition.fieldId)

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

  return (
    <div
      data-slot="condition-badge"
      className={cn(
        'inline-flex items-center rounded-xl bg-primary-200/30 border shrink-0',
        isHighlighted && 'ring-2 ring-info',
        isHovered && 'bg-destructive/10 border-destructive/20',
        className
      )}>
      <div className="flex flex-row items-center p-0 gap-0">
        {/* Field Selector */}
        <div className="max-w-[120px]">
          <ResourceFieldSelector
            value={condition.fieldId}
            onChange={handleFieldChange}
            disabled={readOnly}
            placeholder="Field"
            className="h-5 w-full border-0 px-1 text-xs bg-transparent"
            availableFields={getAvailableFields()}
          />
        </div>

        {/* Operator Selector */}
        <ConditionOperator
          fieldId={condition.fieldId}
          value={condition.operator}
          onChange={handleOperatorChange}
          disabled={!condition.fieldId || readOnly}
        />

        {/* Value Input */}
        {fieldDef && operatorRequiresValue(condition.operator) && (
          <>
            <div className="h-3 w-[1px] bg-divider shrink-0" />
            <div className="min-w-[80px] max-w-[150px]">
              <ResourceInput
                condition={condition}
                field={fieldDef}
                value={condition.value}
                onChange={handleValueChange}
                disabled={readOnly}
                className="text-xs"
              />
            </div>
          </>
        )}

        {/* Remove Button */}
        {showRemoveButton && !readOnly && (
          <>
            <div className="h-3 w-[1px] bg-divider shrink-0 ml-1" />
            <button
              type="button"
              onClick={handleRemove}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              className={cn(
                'rounded-full size-5 flex items-center justify-center ml-0.5 mr-0.5',
                'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
              )}
              aria-label="Remove condition">
              <X className="size-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
