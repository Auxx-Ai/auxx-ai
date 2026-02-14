// apps/web/src/components/conditions/components/condition-item.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useConditionContext } from '../condition-context'
import ValueInput from '../inputs/value-input'
import type { ConditionItemProps, Operator } from '../types'
import { operatorRequiresValue } from '../types'
import ConditionOperator from './condition-operator'
import ResourceFieldSelector from './resource-field-selector'
import VariableFieldSelector from './variable-field-selector'

/**
 * Generic condition item component that works with both if-else and find systems
 */
const ConditionItem = ({
  condition,
  groupId,
  showRemoveButton = true,
  compactMode = false,
  className,
  onUpdate,
  onRemove,
}: ConditionItemProps) => {
  const [isHovered, setIsHovered] = useState(false)
  const {
    config,
    readOnly,
    updateCondition,
    removeCondition,
    getFieldDefinition,
    getAvailableFields,
    nodeId,
  } = useConditionContext()

  const display = config.display ?? 'stacked'
  const isInline = display === 'inline'

  /** Resolve fieldId to a plain string (handles branded and array formats) */
  const resolvedFieldId = Array.isArray(condition.fieldId)
    ? (condition.fieldId[0] ?? '')
    : (condition.fieldId as string)

  const fieldDef = getFieldDefinition(resolvedFieldId)

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

  /** Value input block — placed inline or stacked depending on config.display */
  const valueBlock =
    fieldDef && operatorRequiresValue(condition.operator) ? (
      <div
        className={cn(
          'px-1 py-0.5',
          isInline ? 'border-l border-l-divider w-0 grow' : 'border-t border-t-divider',
          isHovered && 'border-destructive/20',
          compactMode && 'max-h-[60px] overflow-y-auto'
        )}>
        <ValueInput
          condition={condition}
          field={fieldDef}
          value={condition.value}
          onChange={handleValueChange}
          disabled={readOnly}
          nodeId={nodeId}
          className='text-xs w-full pe-1'
        />
      </div>
    ) : null

  return (
    <div className={cn('mb-1 flex last-of-type:mb-0', className)}>
      <div
        className={cn(
          'grow rounded-xl bg-primary-200/30 border',
          isHovered && 'bg-destructive/10 border-destructive/20'
        )}>
        <div className={cn('flex items-center', isInline ? 'ps-1' : 'p-1')}>
          <div className='w-0 grow'>
            {config.mode === 'variable' && nodeId ? (
              <VariableFieldSelector
                value={resolvedFieldId}
                onChange={handleFieldChange}
                disabled={readOnly}
                placeholder='Select field'
                className='h-6 w-full border-0 px-0 text-xs'
                nodeId={nodeId}
              />
            ) : (
              <ResourceFieldSelector
                value={resolvedFieldId}
                onChange={handleFieldChange}
                disabled={readOnly}
                placeholder='Select field'
                className='h-6 w-full border-0 px-0 text-xs'
                availableFields={getAvailableFields()}
              />
            )}
          </div>

          <div className='mx-1 h-3 w-[1px] bg-divider'></div>

          <ConditionOperator
            fieldId={resolvedFieldId}
            value={condition.operator}
            onChange={handleOperatorChange}
            disabled={!resolvedFieldId || readOnly}
          />

          {isInline && valueBlock}
        </div>

        {!isInline && valueBlock}
      </div>

      {showRemoveButton && !readOnly && (
        <Button
          className='ml-1'
          onClick={handleRemove}
          variant='destructive-hover'
          size='xs'
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}>
          <Trash2 className='size-6 shrink-0' />
        </Button>
      )}
    </div>
  )
}

export default ConditionItem
