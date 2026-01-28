// apps/web/src/components/conditions/components/condition-item.tsx

'use client'

import { useCallback, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { useConditionContext } from '../condition-context'
import ConditionOperator from './condition-operator'
import VariableFieldSelector from './variable-field-selector'
import ResourceFieldSelector from './resource-field-selector'
import ValueInput from '../inputs/value-input'
import { operatorRequiresValue } from '../types'
import type { ConditionItemProps, Operator } from '../types'

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

  console.log('ConditionItem render:', condition.fieldId)
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
    <div className={cn('mb-1 flex last-of-type:mb-0', className)}>
      <div
        className={cn(
          'grow rounded-xl bg-primary-200/30 border',
          isHovered && 'bg-destructive/10 border-destructive/20'
        )}>
        <div className="flex items-center p-1">
          <div className="w-0 grow">
            {config.mode === 'variable' && nodeId ? (
              <VariableFieldSelector
                value={condition.fieldId}
                onChange={handleFieldChange}
                disabled={readOnly}
                placeholder="Select field"
                className="h-6 w-full border-0 px-0 text-xs"
                nodeId={nodeId}
              />
            ) : (
              <ResourceFieldSelector
                value={condition.fieldId}
                onChange={handleFieldChange}
                disabled={readOnly}
                placeholder="Select field"
                className="h-6 w-full border-0 px-0 text-xs"
                availableFields={getAvailableFields()}
              />
            )}
          </div>

          <div className="mx-1 h-3 w-[1px] bg-divider"></div>

          <ConditionOperator
            fieldId={condition.fieldId}
            value={condition.operator}
            onChange={handleOperatorChange}
            disabled={!condition.fieldId || readOnly}
          />
        </div>

        {fieldDef && operatorRequiresValue(condition.operator) && (
          <div
            className={cn(
              'border-t border-t-divider px-1 py-0.5',
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
              className="text-xs"
            />
          </div>
        )}
      </div>

      {showRemoveButton && !readOnly && (
        <Button
          className="ml-1"
          onClick={handleRemove}
          variant="destructive-hover"
          size="xs"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}>
          <Trash2 className="size-6 shrink-0" />
        </Button>
      )}
    </div>
  )
}

export default ConditionItem
