// apps/web/src/components/conditions/components/condition-add.tsx

'use client'

import type { FieldReference } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useConditionContext } from '../condition-context'
import type { ConditionAddProps, FieldDefinition } from '../types'
import { NavigableFieldSelector } from './navigable-field-selector'
import ResourceFieldSelector from './resource-field-selector'
import VariableFieldSelector from './variable-field-selector'

/**
 * Generic condition add component that can work with both variable and resource-based systems.
 * When entityDefinitionId is available, uses NavigableFieldSelector for drill-down.
 */
const ConditionAdd = memo(
  ({
    groupId,
    disabled,
    className,
    buttonText = 'Add Condition',
    buttonIcon = <Plus />,
  }: ConditionAddProps) => {
    const [open, setOpen] = useState(false)
    const { config, addCondition, getAvailableFields, nodeId } = useConditionContext()

    const useNavigable = config.mode === 'resource' && !!config.entityDefinitionId

    /** Handle field selection from legacy selectors */
    const handleFieldSelect = useCallback(
      (fieldId: string) => {
        addCondition(fieldId, undefined, groupId)
        setOpen(false)
      },
      [addCondition, groupId]
    )

    /** Handle field selection from NavigableFieldSelector */
    const handleNavigableFieldSelect = useCallback(
      (fieldReference: FieldReference, fieldDef: FieldDefinition) => {
        addCondition(fieldReference as string | string[], fieldDef, groupId)
        setOpen(false)
      },
      [addCondition, groupId]
    )

    /** Shared trigger button */
    const renderTrigger = useCallback(
      ({ onClick }: { onClick: () => void }) => (
        <Button
          size='sm'
          variant='outline'
          className={className}
          disabled={disabled}
          onClick={onClick}>
          {buttonIcon}
          {buttonText}
        </Button>
      ),
      [className, disabled, buttonText, buttonIcon]
    )

    if (config.mode === 'variable' && nodeId) {
      return (
        <VariableFieldSelector
          value=''
          onChange={handleFieldSelect}
          nodeId={nodeId}
          renderTrigger={renderTrigger}
        />
      )
    }

    if (useNavigable) {
      return (
        <NavigableFieldSelector
          value={undefined}
          onSelect={handleNavigableFieldSelect}
          entityDefinitionId={config.entityDefinitionId!}
          disabled={disabled}
          open={open}
          onOpenChange={setOpen}
          renderTrigger={renderTrigger}
        />
      )
    }

    if (config.mode === 'resource') {
      return (
        <ResourceFieldSelector
          value=''
          onChange={handleFieldSelect}
          availableFields={getAvailableFields()}
          disabled={disabled || getAvailableFields().length === 0}
          open={open}
          onOpenChange={setOpen}
          renderTrigger={renderTrigger}
        />
      )
    }

    return null
  }
)

ConditionAdd.displayName = 'ConditionAdd'

export default ConditionAdd
