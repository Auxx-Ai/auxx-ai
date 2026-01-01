// apps/web/src/components/conditions/components/condition-add.tsx

'use client'

import { useCallback, useState, memo } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { useConditionContext } from '../condition-context'
import { VariablePicker } from '~/components/workflow/ui/variables/variable-picker'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@auxx/ui/components/select'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import type { ConditionAddProps } from '../types'
import { cn } from '@auxx/ui/lib/utils'
import { VarTypeIcon } from '~/components/workflow/utils'
import { Badge } from '@auxx/ui/components/badge'

/**
 * Generic condition add component that can work with both variable and resource-based systems
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

    const handleFieldSelect = useCallback(
      (fieldId: string) => {
        addCondition(fieldId, groupId)
        setOpen(false)
      },
      [addCondition, groupId]
    )

    const handleVariableSelect = useCallback(
      (variable: UnifiedVariable) => {
        addCondition(variable.id, groupId)
        setOpen(false)
      },
      [addCondition, groupId]
    )

    // For variable-based systems (like if-else), use VariablePicker
    if (config.mode === 'variable' && nodeId) {
      const renderTrigger = useCallback(
        ({ onClick }: { onClick: () => void }) => (
          <Button
            size="sm"
            variant="outline"
            className={className}
            disabled={disabled}
            onClick={onClick}>
            {buttonIcon}
            {buttonText}
          </Button>
        ),
        [className, disabled, buttonText, buttonIcon]
      )

      return (
        <VariablePicker
          open={open}
          onOpenChange={setOpen}
          nodeId={nodeId}
          onVariableSelect={handleVariableSelect}
          renderTrigger={renderTrigger}
        />
      )
    }

    // For resource-based systems (like find), use field selector
    if (config.mode === 'resource') {
      const availableFields = getAvailableFields()

      return (
        <Select
          open={open}
          onOpenChange={setOpen}
          onValueChange={handleFieldSelect}
          value=""
          disabled={disabled || availableFields.length === 0}>
          <SelectTrigger
            className={cn('w-auto rounded-lg', className)}
            variant="outline"
            size="sm">
            <div className="flex items-center gap-1 [&>svg]:size-4">
              {buttonIcon}
              {buttonText}
            </div>
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {availableFields.map((field) => (
              <SelectItem key={field.id} value={field.id} className="ps-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="rounded-full ring-1 ring-ring bg-secondary flex items-center justify-center size-4">
                    <VarTypeIcon type={field.type} className="size-3 text-blue-500" />
                  </div>
                  <span>{field.label}</span>
                  <Badge variant="purple" size="xs" className="text-[10px]">
                    {field.type}
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    // For custom field selector
    if (config.customFieldSelector) {
      const CustomFieldSelector = config.customFieldSelector
      return (
        <CustomFieldSelector
          onFieldSelect={handleFieldSelect}
          disabled={disabled}
          className={className}
          buttonText={buttonText}
          buttonIcon={buttonIcon}
        />
      )
    }

    // Fallback for unsupported modes
    return (
      <Button size="sm" variant="outline" className={className} disabled={true}>
        {buttonIcon}
        {buttonText} (Unsupported)
      </Button>
    )
  }
)

ConditionAdd.displayName = 'ConditionAdd'

export default ConditionAdd
