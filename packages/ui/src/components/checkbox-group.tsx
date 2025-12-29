// packages/ui/src/components/checkbox-group.tsx
'use client'

import * as React from 'react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import { Check } from 'lucide-react'
import { Label } from '@auxx/ui/components/label'
import { cn } from '@auxx/ui/lib/utils'

/** Context value for CheckboxGroup state management */
interface CheckboxGroupContextValue {
  value: string[]
  onValueChange: (value: string[]) => void
  disabled?: boolean
}

const CheckboxGroupContext = React.createContext<CheckboxGroupContextValue | null>(null)

/** Hook to access CheckboxGroup context */
function useCheckboxGroup() {
  const context = React.useContext(CheckboxGroupContext)
  if (!context) {
    throw new Error('CheckboxGroupItem must be used within a CheckboxGroup')
  }
  return context
}

/** Props for CheckboxGroup root component */
interface CheckboxGroupProps {
  value?: string[]
  defaultValue?: string[]
  onValueChange?: (value: string[]) => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
}

/** Props for CheckboxGroupItem component */
interface CheckboxGroupItemProps {
  /** Unique value for this checkbox item */
  value: string
  /** Icon component to display */
  icon?: React.ReactNode
  /** Main label text */
  label: string
  /** Optional sublabel text shown in parentheses */
  sublabel?: string
  /** Description text shown below the label */
  description?: string
  /** Optional ID override */
  id?: string
  /** Whether this item is disabled */
  disabled?: boolean
  /** Additional CSS classes for the container */
  className?: string
}

/** Root component that manages multi-selection state */
function CheckboxGroup({
  value: controlledValue,
  defaultValue = [],
  onValueChange,
  disabled,
  className,
  children,
}: CheckboxGroupProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const value = controlledValue ?? internalValue

  const handleValueChange = React.useCallback(
    (newValue: string[]) => {
      if (controlledValue === undefined) {
        setInternalValue(newValue)
      }
      onValueChange?.(newValue)
    },
    [controlledValue, onValueChange]
  )

  return (
    <CheckboxGroupContext.Provider value={{ value, onValueChange: handleValueChange, disabled }}>
      <div className={cn('grid gap-3', className)} role="group">
        {children}
      </div>
    </CheckboxGroupContext.Provider>
  )
}

/** Styled checkbox item with icon, label, sublabel, description. Checkbox on the right. */
function CheckboxGroupItem({
  className,
  icon,
  label,
  sublabel,
  description,
  id,
  value,
  disabled: itemDisabled,
}: CheckboxGroupItemProps) {
  const { value: groupValue, onValueChange, disabled: groupDisabled } = useCheckboxGroup()
  const isChecked = groupValue.includes(value)
  const disabled = itemDisabled || groupDisabled
  const itemId = id || `checkbox-${value}`
  const descriptionId = `${itemId}-description`

  const handleCheckedChange = (checked: boolean) => {
    if (checked) {
      onValueChange([...groupValue, value])
    } else {
      onValueChange(groupValue.filter((v) => v !== value))
    }
  }

  return (
    <div
      className={cn(
        'group flex items-center justify-between relative rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200',
        isChecked && 'border-info ring-4 ring-info/20',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}>
      {/* Checkbox on the right */}
      <CheckboxPrimitive.Root
        id={itemId}
        checked={isChecked}
        onCheckedChange={handleCheckedChange}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        className="order-1 after:absolute after:inset-0 size-5 shrink-0 rounded-sm border border-primary-300 shadow-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-info data-[state=checked]:text-primary-foreground data-[state=checked]:dark:text-white data-[state=checked]:border-blue-800 transition-colors">
        <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
          <Check className="size-3.5" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>

      {/* Content on the left */}
      <div className="flex grow items-start gap-3">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors overflow-hidden shrink-0">
              <div className="flex-shrink-0 [&_svg]:size-4">{icon}</div>
            </div>
          )}
          <div className="grid grow gap-0.5">
            <Label htmlFor={itemId} className="font-normal">
              {label}
              {sublabel && (
                <span className="text-muted-foreground text-xs leading-[inherit] font-normal">
                  {' '}
                  ({sublabel})
                </span>
              )}
            </Label>
            {description && (
              <p id={descriptionId} className="text-muted-foreground text-xs">
                {description}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export {
  CheckboxGroup,
  CheckboxGroupItem,
  useCheckboxGroup,
  type CheckboxGroupProps,
  type CheckboxGroupItemProps,
}
