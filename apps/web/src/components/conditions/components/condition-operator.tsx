// apps/web/src/components/conditions/components/condition-operator.tsx

'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { PickerTrigger } from '~/components/ui/picker-trigger'
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
  triggerProps,
  open: controlledOpen,
  onOpenChange,
}: OperatorSelectorProps) => {
  const [internalOpen, setInternalOpen] = useState(false)
  const { getAvailableOperators } = useConditionContext()

  // Support both controlled and uncontrolled modes
  const isOpen = controlledOpen ?? internalOpen
  const setIsOpen = (newOpen: boolean) => {
    setInternalOpen(newOpen)
    onOpenChange?.(newOpen)
  }

  const options = useMemo(() => {
    return getAvailableOperators(fieldId).map((operator) => ({
      label: operator.label,
      value: operator.key,
    }))
  }, [fieldId, getAvailableOperators])

  const selectedOption = options.find((o) => o.value === value)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={isOpen}
          disabled={disabled}
          hasValue={!!selectedOption}
          placeholder='Select operator'
          variant={triggerProps?.variant ?? 'ghost'}
          size={triggerProps?.size ?? 'sm'}
          hideIcon={triggerProps?.hideIcon ?? true}
          className={cn('h-6 px-2 text-xs', className, triggerProps?.className)}>
          {selectedOption?.label}
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent className='w-48 p-0'>
        <MultiSelectPicker
          options={options}
          value={value}
          onChange={(selected) => onChange(selected[0] ?? '')}
          multi={false}
          canManage={false}
          canAdd={false}
          disabled={disabled}
          placeholder='Search operators...'
          onSelectSingle={() => setIsOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

export default ConditionOperator
