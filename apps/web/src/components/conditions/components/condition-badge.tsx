// apps/web/src/components/conditions/components/condition-badge.tsx

'use client'

import { FieldInputMode, resolveFieldInputConfig } from '@auxx/lib/conditions/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConditionContext } from '../condition-context'
import { ResourceInput } from '../inputs/resource-input'
import type { ConditionItemProps, Operator } from '../types'
import ConditionOperator from './condition-operator'
import ResourceFieldSelector from './resource-field-selector'

/**
 * Extended props for ConditionBadge with searchbar support
 */
interface ConditionBadgeProps extends ConditionItemProps {
  /** Whether this badge is highlighted via keyboard navigation */
  isHighlighted?: boolean
  /** Prevents field selection, shows label as static text */
  lockField?: boolean
}

/**
 * ConditionBadge - single-row inline editable condition component.
 * Layout: [Field ▾] │ [Operator ▾] │ [Value Input] │ [X]
 * All in one compact row for use in searchbar and other inline contexts.
 */
/** Type for tracking which section has focus */
type FocusedSection = 'operator' | 'value' | null

export const ConditionBadge = ({
  condition,
  groupId,
  showRemoveButton = true,
  compactMode = false,
  isHighlighted = false,
  lockField = false,
  className,
  onUpdate,
  onRemove,
}: ConditionBadgeProps) => {
  const [isHovered, setIsHovered] = useState(false)
  const [focusedSection, setFocusedSection] = useState<FocusedSection>(null)
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
  // Only auto-open if the operator requires a value input and no section is focused
  // biome-ignore lint/correctness/useExhaustiveDependencies: condition.value and focusedSection are intentionally excluded to only trigger on condition creation
  useEffect(() => {
    if (condition.value === undefined && focusedSection === null && hasInput) {
      setFocusedSection('value')
    }
  }, [hasInput])

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

      // Open operator selector after field selection
      setFocusedSection('operator')
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
        // Keep as array for relationship fields - just limit to first element
        if (Array.isArray(newValue)) {
          newValue = newValue.length > 0 && newValue[0] ? [newValue[0]] : []
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
      data-slot='condition-badge'
      className={cn(
        'flex flex-row h-6 items-center rounded-xl bg-primary-200/30 border shrink-0 [&>*:last-child]:rounded-r-xl',
        isHighlighted && 'ring-2 ring-info',
        isHovered && 'bg-destructive/10 border-destructive/20',
        className
      )}>
      {/* Field Selector */}
      {lockField ? (
        <span
          className={cn(
            'h-6 px-1.5 text-xs flex items-center border-r text-muted-foreground shrink-0',
            isHovered && 'border-destructive/20'
          )}>
          {fieldDef?.label ?? 'Field'}
        </span>
      ) : (
        <ResourceFieldSelector
          value={condition.fieldId}
          onChange={handleFieldChange}
          disabled={readOnly}
          placeholder='Field'
          availableFields={getAvailableFields()}
          renderTrigger={() => (
            <Button
              variant='transparent'
              className={cn(
                'h-6 hover:bg-primary-200/50 px-1.5 text-xs rounded-r-none border-r',
                isHovered && 'border-destructive/20'
              )}>
              {fieldDef?.label ?? 'Field'}
            </Button>
          )}
        />
      )}

      {/* Operator Selector */}
      <ConditionOperator
        fieldId={condition.fieldId}
        value={condition.operator}
        onChange={handleOperatorChange}
        disabled={!condition.fieldId || readOnly}
        className={cn(
          'h-6 hover:bg-primary-200/50 px-1.5 text-xs rounded-none border-r',
          isHovered && 'border-destructive/20'
        )}
        open={focusedSection === 'operator'}
        onOpenChange={(open) => {
          if (open) {
            setFocusedSection('operator')
          } else {
            // Cascade to value picker if operator requires value input
            const newInputConfig = resolveFieldInputConfig(
              fieldDef?.fieldType ?? 'TEXT',
              condition.operator
            )
            if (newInputConfig.mode !== FieldInputMode.NONE) {
              setFocusedSection('value')
            } else {
              setFocusedSection(null)
            }
          }
        }}
      />

      {/* Value Input */}
      <ResourceInput
        condition={condition}
        field={fieldDef}
        value={condition.value}
        onChange={handleValueChange}
        disabled={readOnly}
        inputClassName='text-xs px-1'
        autoGrow={{ minWidth: 30, placeholderIsMinWidth: true }}
        triggerProps={{
          size: 'sm',
          className: 'min-h-6 h-6 ps-1 pe-1 mx-0',
          hideIcon: true,
          showClear: false,
        }}
        open={focusedSection === 'value'}
        onOpenChange={(open) => setFocusedSection(open ? 'value' : null)}
      />

      {/* Remove Button */}
      {showRemoveButton && !readOnly && (
        <div
          onClick={handleRemove}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={cn(
            'h-6 w-7 cursor-pointer rounded-r-xl flex items-center shrink-0 justify-center ',
            'text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/20',
            hasInput ? 'border-l' : ''
          )}
          aria-label='Remove condition'>
          <X className='size-3.5 shrink-0' />
        </div>
      )}
    </div>
  )
}
