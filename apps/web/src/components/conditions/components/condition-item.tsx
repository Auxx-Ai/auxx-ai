// apps/web/src/components/conditions/components/condition-item.tsx

'use client'

import type { FieldReference } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { CURRENT_USER_ACTOR_ID } from '~/components/pickers/actor-picker/actor-picker-content'
import { useConditionContext } from '../condition-context'
import ValueInput from '../inputs/value-input'
import type { ConditionItemProps, FieldDefinition, Operator } from '../types'
import { operatorRequiresValue } from '../types'
import ConditionOperator from './condition-operator'
import { NavigableFieldSelector } from './navigable-field-selector'
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
    registerFieldDefinition,
    getAvailableFields,
    nodeId,
  } = useConditionContext()

  const display = config.display ?? 'stacked'
  const isInline = display === 'inline'

  // Use entityDefinitionId to determine if NavigableFieldSelector should be used
  const useNavigable = config.mode === 'resource' && !!config.entityDefinitionId

  const fieldDef = getFieldDefinition(condition.fieldId)

  /** Resolve fieldId to a plain string for legacy selectors */
  const resolvedFieldId = Array.isArray(condition.fieldId)
    ? (condition.fieldId[0] ?? '')
    : (condition.fieldId as string)

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

  /** Handle field change from NavigableFieldSelector */
  const handleNavigableFieldChange = useCallback(
    (fieldReference: FieldReference, fieldDef: FieldDefinition) => {
      registerFieldDefinition(fieldReference as string | string[], fieldDef)
      const firstOperator = fieldDef.operators?.[0] || 'is'
      handleUpdate({
        fieldId: fieldReference as string | string[],
        operator: firstOperator,
        value: '',
        valueSource: undefined,
      })
    },
    [handleUpdate, registerFieldDefinition]
  )

  /** Handle field change from legacy selectors */
  const handleFieldChange = useCallback(
    (fieldId: string) => {
      const newFieldDef = getFieldDefinition(fieldId)
      if (!newFieldDef) return

      const firstOperator = newFieldDef.operators?.[0] || 'is'
      handleUpdate({
        fieldId,
        operator: firstOperator,
        value: '',
        valueSource: undefined,
        variableId: config.mode === 'variable' ? fieldId : condition.variableId,
      })
    },
    [getFieldDefinition, handleUpdate, config.mode, condition.variableId]
  )

  /** Handle array accessor change from right-click context menu (don't reset operator/value) */
  const handleFieldAccessorChange = useCallback(
    (newFieldId: string) => {
      // Re-register field def under the new key so operators keep working.
      // The cache is keyed by exact fieldId, so [0] and [*] are different entries.
      const normalizedId = newFieldId.replace(/\[-?\d+\]/g, '[*]')
      const existingDef = getFieldDefinition(normalizedId) || getFieldDefinition(condition.fieldId)
      if (existingDef) {
        registerFieldDefinition(newFieldId, existingDef)
      }
      handleUpdate({
        fieldId: newFieldId,
        variableId: config.mode === 'variable' ? newFieldId : condition.variableId,
      })
    },
    [
      handleUpdate,
      config.mode,
      condition.variableId,
      condition.fieldId,
      getFieldDefinition,
      registerFieldDefinition,
    ]
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

  const isActorField = fieldDef?.fieldType === 'ACTOR'
  const allowCurrentUser = Boolean(config.allowCurrentUserPlaceholder && isActorField)

  /**
   * For actor-field filters: hydrate the stored condition (value + valueSource)
   * into a single array for the picker. The sentinel rides alongside any real
   * actor IDs — see CURRENT_USER_ACTOR_ID in actor-picker-content.
   */
  const hydratedValue = useMemo(() => {
    if (!allowCurrentUser) return condition.value
    const base = Array.isArray(condition.value)
      ? condition.value
      : condition.value
        ? [condition.value]
        : []
    if (condition.valueSource === 'currentUser' && !base.includes(CURRENT_USER_ACTOR_ID)) {
      return [...base, CURRENT_USER_ACTOR_ID]
    }
    return base
  }, [allowCurrentUser, condition.value, condition.valueSource])

  const handleValueChange = useCallback(
    (value: any, isConstantMode?: boolean, metadata?: Record<string, any>) => {
      let nextValue = value
      let nextValueSource: 'currentUser' | undefined = condition.valueSource

      // Actor fields in filter context: extract the sentinel into valueSource
      // so the persisted shape stays { value: ActorId[], valueSource? }.
      if (allowCurrentUser && Array.isArray(value)) {
        const hasSentinel = value.includes(CURRENT_USER_ACTOR_ID)
        nextValue = value.filter((v: unknown) => v !== CURRENT_USER_ACTOR_ID)
        nextValueSource = hasSentinel ? 'currentUser' : undefined
      }

      const updates: any = { value: nextValue }
      if (isConstantMode !== undefined) {
        updates.isConstant = isConstantMode
      }
      if (metadata) {
        updates.metadata = { ...condition.metadata, ...metadata }
      }
      if (allowCurrentUser && nextValueSource !== condition.valueSource) {
        updates.valueSource = nextValueSource
      }
      handleUpdate(updates)
    },
    [handleUpdate, condition.metadata, condition.valueSource, allowCurrentUser]
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
          value={hydratedValue}
          onChange={handleValueChange}
          disabled={readOnly}
          nodeId={nodeId}
          className='text-xs w-full pe-1'
          allowCurrentUser={allowCurrentUser}
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
                onAccessorChange={handleFieldAccessorChange}
                disabled={readOnly}
                placeholder='Select field'
                className='h-6 w-full border-0 px-0 text-xs'
                nodeId={nodeId}
              />
            ) : useNavigable ? (
              <NavigableFieldSelector
                value={condition.fieldId as FieldReference | undefined}
                onSelect={handleNavigableFieldChange}
                entityDefinitionId={config.entityDefinitionId!}
                disabled={readOnly}
                placeholder='Select field'
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
            fieldId={condition.fieldId}
            value={condition.operator}
            onChange={handleOperatorChange}
            disabled={!condition.fieldId || readOnly}
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
