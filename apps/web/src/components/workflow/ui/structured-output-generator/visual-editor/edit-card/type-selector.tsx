// apps/web/src/components/workflow/ui/structured-output-generator/visual-editor/edit-card/type-selector.tsx
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import type { ArrayType, Type } from '../../types'
import type { FC } from 'react'
import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'

export type TypeItem = { value: Type | ArrayType; text: string }

type TypeSelectorProps = {
  items: TypeItem[]
  currentValue: Type | ArrayType
  onSelect: (item: TypeItem) => void
  popupClassName?: string
}

const TypeSelector: FC<TypeSelectorProps> = ({ items, currentValue, onSelect, popupClassName }) => {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className={cn(open && 'bg-state-base-hover')}>
          <span className="system-xs-medium text-primary-500">{currentValue}</span>
          <ChevronDown className="size-4 text-primary-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-40 p-1', popupClassName)} align="start" sideOffset={4}>
        <div className="space-y-0.5">
          {items.map((item) => {
            const isSelected = item.value === currentValue
            return (
              <div
                key={item.value}
                className="flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1 hover:bg-primary-100"
                onClick={() => {
                  onSelect(item)
                  setOpen(false)
                }}>
                <span className="text-sm px-1 text-primary-900">{item.text}</span>
                {isSelected && <Check className="size-4 text-good-500" />}
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default TypeSelector
