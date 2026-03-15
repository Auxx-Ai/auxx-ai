// apps/web/src/components/ui/picker-trigger.tsx
'use client'

import { Button, type ButtonProps } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, X } from 'lucide-react'
import type { ReactNode, Ref } from 'react'

/**
 * Props that can be passed to customize picker triggers.
 * Used by FieldInputAdapter and parent components.
 */
export interface PickerTriggerOptions {
  /** Button variant - default varies by component */
  variant?: ButtonProps['variant']

  /** Button size */
  size?: ButtonProps['size']

  /** Whether to show clear button (overrides default multi logic) */
  showClear?: boolean

  /** Icon to display */
  icon?: ReactNode

  /** Icon position */
  iconPosition?: 'start' | 'end'

  /** Hide the icon entirely */
  hideIcon?: boolean

  /** Additional className for trigger */
  className?: string

  /** Size for badges rendered inside the trigger */
  badgeSize?: 'default' | 'sm'
}

/**
 * Props for PickerTrigger component
 */
export interface PickerTriggerProps {
  /** Ref to the button element */
  ref?: Ref<HTMLButtonElement>

  /** Whether picker is open (for aria-expanded) */
  open?: boolean

  /** Whether trigger is disabled */
  disabled?: boolean

  /** Button variant */
  variant?: ButtonProps['variant']

  /** Button size */
  size?: ButtonProps['size']

  /** Additional className */
  className?: string

  /** Whether to show clear button */
  showClear?: boolean

  /** Handler for clear button click */
  onClear?: (e: React.MouseEvent) => void

  /** Whether field has a value */
  hasValue: boolean

  /** Icon to show */
  icon?: ReactNode

  /** Icon position */
  iconPosition?: 'start' | 'end'

  /** Hide the icon entirely */
  hideIcon?: boolean

  /** Placeholder text */
  placeholder?: string

  /** Content to render when hasValue */
  children?: ReactNode

  /** Whether to use combobox role */
  asCombobox?: boolean
}

/**
 * PickerTrigger
 * Unified trigger button for picker components.
 * Handles common patterns: placeholder, clear button, icon positioning.
 */
export function PickerTrigger({
  ref,
  open,
  disabled,
  variant = 'transparent',
  size,
  className,
  showClear = false,
  onClear,
  hasValue,
  icon,
  iconPosition = 'end',
  hideIcon = false,
  placeholder = 'Select...',
  children,
  asCombobox = false,
  ...props
}: PickerTriggerProps) {
  const defaultIcon = <ChevronDown className='size-4 opacity-50' />
  const displayIcon = hideIcon ? null : (icon ?? defaultIcon)

  /** Handle clear button click */
  const handleClearClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClear?.(e)
  }

  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      disabled={disabled}
      role={asCombobox ? 'combobox' : undefined}
      aria-expanded={asCombobox ? open : undefined}
      className={cn(
        'justify-between font-normal',
        // iconPosition === 'start' ? 'ps-2 pe-3' : 'ps-0 pe-1',
        className
      )}
      {...props}>
      {/* Leading icon */}
      {iconPosition === 'start' && displayIcon}

      {/* Value or placeholder */}
      <div className='flex-1 min-w-0 flex items-center gap-2'>
        {hasValue ? (
          children
        ) : (
          <span className='text-primary-400 text-sm font-normal pointer-events-none truncate'>
            {placeholder}
          </span>
        )}
      </div>

      {/* Trailing area: clear button + icon */}
      {iconPosition === 'end' && (displayIcon || showClear) && (
        <div className='flex items-center gap-1 ml-2 shrink-0'>
          {showClear && hasValue && (
            <div
              className='size-4 flex items-center justify-center rounded-full bg-primary-500/30 text-primary-100 transition-colors hover:bg-bad-100 hover:text-bad-500'
              onClick={handleClearClick}>
              <X className='size-3!' />
            </div>
          )}
          {displayIcon}
        </div>
      )}
    </Button>
  )
}
