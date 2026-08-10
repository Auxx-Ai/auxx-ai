'use client'

import { Label } from '@auxx/ui/components/label'
import { RadioGroupItem as BaseRadioGroupItem } from '@auxx/ui/components/radio-group'
import { cn } from '@auxx/ui/lib/utils'
import type { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import type * as React from 'react'

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
        // ⚠️ `gap-3`: there was no gap at all, so a multi-line description ran
        // straight into the radio on the right. The text block below carries
        // `grow`, which makes that collision certain rather than occasional.
        'group flex items-center justify-between gap-3 relative rounded-2xl border py-2 px-3 hover:bg-muted transition-colors  duration-200 has-data-[state=checked]:border-info has-data-[state=checked]:ring-4 has-data-[state=checked]:ring-info/20',
        // 'border-input hover:bg-primary-50 has-data-[state=checked]:border-primary-800/50 relative flex w-full items-start gap-2 rounded-md border p-4 shadow-xs outline-none',
        className
      )}>
      <BaseRadioGroupItem
        value={value}
        id={itemId}
        variant='accent'
        size='lg'
        aria-describedby={description ? descriptionId : undefined}
        className='order-1 after:absolute after:inset-0'
        {...props}
      />
      {/* One row, not two nested ones — the old outer wrapper carried a `gap-3`
          it could never apply (it had a single child) and an `items-start` the
          inner `items-center` immediately overrode. */}
      <div className='flex min-w-0 grow items-start gap-3'>
        {icon && (
          // ⚠️ `items-start` + `mt-0.5`, not `items-center`: centred against a
          // two- or three-line description the icon floats in the middle of the
          // block and reads as detached from the text it belongs to. Aligning it
          // to the label keeps the pairing obvious at any description length.
          <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0 relative mt-0.5 [&_svg]:size-4'>
            {icon}
          </div>
        )}
        {/* `min-w-0` so a long description wraps inside the card instead of
            sizing this column to its min-content and shoving the radio out. */}
        <div className='grid min-w-0 grow gap-0.5'>
          <Label htmlFor={itemId} className='font-normal '>
            {label}
            {sublabel && (
              <span className='text-muted-foreground text-xs leading-[inherit] font-normal'>
                {' '}
                ({sublabel})
              </span>
            )}
          </Label>
          {description && (
            <p id={descriptionId} className='text-muted-foreground text-xs'>
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export { RadioGroupItemCard }
