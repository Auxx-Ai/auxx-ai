// apps/web/src/components/conditions/components/field-selector.tsx

'use client'

import { Variable } from 'lucide-react'
import { useConditionContext } from '../condition-context'
import VariableInput from '~/components/workflow/ui/variables/variable-input'
import { VarTypeIcon } from '~/components/workflow/utils/icon-helper'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import type { FieldSelectorProps } from '../types'
import { Badge } from '@auxx/ui/components/badge'

/**
 * Generic field selector that works with both variable and resource-based systems
 */
const FieldSelector = ({
  value,
  onChange,
  disabled,
  placeholder = 'Select field',
  className,
  popoverWidth = 400,
  popoverHeight = 500,
}: FieldSelectorProps) => {
  const { config, getAvailableFields, nodeId } = useConditionContext()

  const handleVariableSelect = (variable: UnifiedVariable) => {
    onChange(variable.id)
  }

  // For variable-based systems (like if-else), use VariableInput
  if (config.mode === 'variable' && nodeId) {
    return (
      <VariableInput
        variableId={value}
        onVariableSelect={handleVariableSelect}
        disabled={disabled}
        nodeId={nodeId}
        placeholder={placeholder}
        className={className}
        popoverWidth={popoverWidth}
        popoverHeight={popoverHeight}
      />
    )
  }

  // For resource-based systems (like find), use field selector
  if (config.mode === 'resource') {
    const availableFields = getAvailableFields()
    return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={className} variant="transparent">
          <SelectValue placeholder={placeholder}>
            {value && (
              <div className="flex cursor-pointer justify-start">
                <div className="inline-flex h-6 max-w-full items-center rounded-md border-[0.5px] border-border bg-background px-1.5 text-primary-500 shadow-xs">
                  <Variable className="size-3.5 shrink-0 text-accent-500" />
                  <div className="ml-0.5 truncate text-xs font-medium">
                    {availableFields.find((f) => f.id === value)?.label || value}
                  </div>
                </div>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
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
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
      />
    )
  }

  // Fallback
  return (
    <div className={`flex h-6 items-center px-2 text-xs text-muted-foreground ${className || ''}`}>
      No field selector available
    </div>
  )
}

export default FieldSelector
