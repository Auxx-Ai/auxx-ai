'use client'

import * as React from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { RadioGroupItem as BaseRadioGroupItem } from '@auxx/ui/components/radio-group'
import { Label } from '@auxx/ui/components/label'
import { cn } from '@auxx/ui/lib/utils'

interface RadioGroupItemCardProps extends React.ComponentProps<typeof RadioGroupPrimitive.Item> {
  /** Icon component to display */
  icon?: React.ReactNode
  /** Main label text */
  label: string
  /** Optional sublabel text shown in parentheses */
  sublabel?: string
  /** Description text shown below the label */
  description?: string
  /** Additional CSS classes for the container */
  className?: string
}

/**
 * Enhanced RadioGroupItem component with icon, label, sublabel, and description
 */
function RadioGroupItemCard({
  className,
  icon,
  label,
  sublabel,
  description,
  id,
  value,
  ...props
}: RadioGroupItemCardProps) {
  const itemId = id || `radio-${value}`
  const descriptionId = `${itemId}-description`

  return (
    <div
      className={cn(
        'group flex items-center justify-between relative rounded-2xl border py-2 px-3 hover:bg-muted transition-colors  duration-200 has-data-[state=checked]:border-info has-data-[state=checked]:ring-4 has-data-[state=checked]:ring-info/20',
        // 'border-input hover:bg-primary-50 has-data-[state=checked]:border-primary-800/50 relative flex w-full items-start gap-2 rounded-md border p-4 shadow-xs outline-none',
        className
      )}>
      <BaseRadioGroupItem
        value={value}
        id={itemId}
        variant="accent"
        size="lg"
        aria-describedby={description ? descriptionId : undefined}
        className="order-1 after:absolute after:inset-0"
        {...props}
      />
      <div className="flex grow items-start gap-3">
        <div className="flex items-center gap-3">
          <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0 relative [&_svg]:size-4">
            {icon && icon}
          </div>
          <div className="grid grow gap-0.5">
            <Label htmlFor={itemId} className="font-normal ">
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

export { RadioGroupItemCard }
