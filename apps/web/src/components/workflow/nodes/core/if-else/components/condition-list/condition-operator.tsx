// apps/web/src/components/workflow/nodes/if-else/components/condition-list/condition-operator.tsx

import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { getOperators } from '../../utils'
import { OPERATOR_LABELS } from '../../constants'
import type { ComparisonOperator, BaseType } from '../../types'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'

type ConditionOperatorProps = {
  className?: string
  disabled?: boolean
  varType?: BaseType
  file?: { key: string }
  value?: ComparisonOperator
  onSelect: (value: ComparisonOperator) => void
}

const ConditionOperator = ({
  className,
  disabled,
  varType,
  file,
  value,
  onSelect,
}: ConditionOperatorProps) => {
  const [open, setOpen] = useState(false)

  const options = useMemo(() => {
    return getOperators(varType, file).map((operator) => ({
      label: OPERATOR_LABELS[operator] || operator,
      value: operator,
    }))
  }, [varType, file])

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
                onSelect(option.value)
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
