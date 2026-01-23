// apps/web/src/components/pickers/actor-picker/actor-picker.tsx

'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { ChevronDown, ChevronsUpDown } from 'lucide-react'
import { Button, type ButtonProps } from '@auxx/ui/components/button'
import { Popover, PopoverContentDialogAware, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { ActorPickerContent, type ActorPickerContentProps } from './actor-picker-content'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { ItemsListView } from '~/components/ui/items-list-view'
import type { ActorId } from '@auxx/types/actor'

/**
 * Props for ActorPicker component
 */
export interface ActorPickerProps
  extends Omit<ActorPickerContentProps, 'onCaptureChange' | 'className'> {
  /** Custom trigger element (if not provided, uses default button) */
  children?: ReactNode

  /** Popover open state (controlled) */
  open?: boolean

  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void

  /** Default trigger: label when no items selected */
  emptyLabel?: string

  /** Popover alignment */
  align?: 'start' | 'center' | 'end'

  /** Popover side */
  side?: 'top' | 'bottom' | 'left' | 'right'

  /** Popover side offset */
  sideOffset?: number

  /** Additional className for popover content */
  contentClassName?: string

  /** Additional className for trigger button */
  triggerClassName?: string

  /** Button variant for the default trigger (default: 'outline') */
  triggerVariant?: ButtonProps['variant']
}

/**
 * ActorPicker - A popover wrapper around ActorPickerContent.
 * Provides a complete dropdown experience for selecting actors.
 *
 * Features:
 * - Custom trigger support via children
 * - Default button trigger showing selection
 * - Controlled or uncontrolled open state
 * - Auto-close on single select
 */
export function ActorPicker({
  children,
  open,
  onOpenChange,
  emptyLabel = 'Select...',
  align = 'start',
  side = 'bottom',
  sideOffset = 5,
  contentClassName,
  triggerClassName,
  triggerVariant = 'outline',
  value,
  onChange,
  multi = true,
  onSelectSingle,
  disabled,
  ...pickerProps
}: ActorPickerProps) {
  // Internal open state (for uncontrolled mode)
  const [internalOpen, setInternalOpen] = useState(false)

  // Use controlled or uncontrolled state
  const isOpen = open ?? internalOpen

  /**
   * Handle open state changes
   */
  const handleOpenChange = (newOpen: boolean) => {
    if (open === undefined) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }

  /**
   * Handle single select - close popover after selection
   */
  const handleSelectSingle = (actorId: ActorId) => {
    onSelectSingle?.(actorId)
    handleOpenChange(false)
  }

  // Sync internal state with controlled state
  useEffect(() => {
    if (open !== undefined && open !== internalOpen) {
      setInternalOpen(open)
    }
  }, [open])

  const hasValue = value.length > 0

  // Custom trigger or default button
  const triggerElement = children ? (
    children
  ) : (
    <Button
      variant={triggerVariant}
      type="button"
      disabled={disabled}
      className={cn('justify-between', triggerClassName)}>
      {hasValue ? (
        <ItemsListView
          items={value.map((id) => ({ id }))}
          renderItem={(item) => <ActorBadge actorId={item.id as ActorId} />}
        />
      ) : (
        <span className="text-primary-400 text-sm font-normal pointer-events-none">
          {emptyLabel}
        </span>
      )}
      <ChevronDown className="opacity-50" />
    </Button>
  )

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{triggerElement}</PopoverTrigger>
      <PopoverContentDialogAware
        className={cn('w-72 p-0', contentClassName)}
        align={align}
        side={side}
        sideOffset={sideOffset}>
        <ActorPickerContent
          value={value}
          onChange={onChange}
          multi={multi}
          onSelectSingle={multi ? undefined : handleSelectSingle}
          disabled={disabled}
          {...pickerProps}
        />
      </PopoverContentDialogAware>
    </Popover>
  )
}
