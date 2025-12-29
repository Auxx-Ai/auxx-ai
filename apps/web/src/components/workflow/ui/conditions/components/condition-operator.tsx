// apps/web/src/components/workflow/ui/conditions/components/condition-operator.tsx

'use client'

import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useConditionContext } from '../condition-context'
import type { OperatorSelectorProps } from '../types'

/**
 * Generic operator selector that works with both if-else and find systems
 */
const ConditionOperator = ({
  fieldId,
  value,
  onChange,
  disabled,
  className,
}: OperatorSelectorProps) => {
  const [open, setOpen] = useState(false)
  const { getAvailableOperators } = useConditionContext()

  const options = useMemo(() => {
    return getAvailableOperators(fieldId).map((operator) => ({
      label: operator.label,
      value: operator.key,
    }))
  }, [fieldId, getAvailableOperators])

  const selectedOption = options.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn('h-6 justify-between px-2 text-xs', className)}>
          {selectedOption?.label || 'Select operator'}
          <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0">
        <div className="max-h-64 overflow-y-auto">
          {options.map((option) => (
            <div
              key={option.value}
              className={cn(
                'flex cursor-pointer items-center h-9 px-3 text-sm hover:bg-accent hover:text-accent-foreground',
                selectedOption?.value === option.value && 'bg-accent/50'
              )}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}>
              {option.label}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default ConditionOperator
