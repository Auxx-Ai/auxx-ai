// apps/web/src/components/conditions/components/condition-add.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useConditionContext } from '../condition-context'
import type { ConditionAddProps } from '../types'
import ResourceFieldSelector from './resource-field-selector'
import VariableFieldSelector from './variable-field-selector'

/**
 * Generic condition add component that can work with both variable and resource-based systems
 * Uses VariableFieldSelector for variable mode and ResourceFieldSelector for resource mode
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

    /** Handle field selection and add condition to group */
    const handleFieldSelect = useCallback(
      (fieldId: string) => {
        addCondition(fieldId, groupId)
        setOpen(false)
      },
      [addCondition, groupId]
    )

    /** Shared trigger button for both field selector modes */
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

    // For variable-based systems (like if-else), use VariableFieldSelector
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

    // For resource-based systems (like find), use ResourceFieldSelector
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
