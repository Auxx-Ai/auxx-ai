// apps/web/src/components/conditions/components/condition-operator.tsx

'use client'

import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useConditionContext } from '../condition-context'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
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
        <MultiSelectPicker
          options={options}
          value={value}
          onChange={(selected) => onChange(selected[0] ?? '')}
          multi={false}
          canManage={false}
          canAdd={false}
          disabled={disabled}
          placeholder="Search operators..."
          onSelectSingle={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

export default ConditionOperator
