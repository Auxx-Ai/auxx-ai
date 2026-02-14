// apps/web/src/components/pickers/record-picker/record-picker.tsx

'use client'

import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Link2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { RecordPickerContent, type RecordPickerContentProps } from './record-picker-content'

/**
 * Props for RecordPicker component
 */
export interface RecordPickerProps
  extends Omit<RecordPickerContentProps, 'onCaptureChange' | 'className'> {
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
}

/**
 * RecordPicker - A popover wrapper around RecordPickerContent.
 * Provides a complete dropdown experience for selecting records.
 *
 * Features:
 * - Custom trigger support via children
 * - Default button trigger showing selection count
 * - Controlled or uncontrolled open state
 * - Auto-close on single select
 */
export function RecordPicker({
  children,
  open,
  onOpenChange,
  emptyLabel = 'Add record',
  align = 'start',
  side = 'bottom',
  sideOffset = 5,
  contentClassName,
  triggerClassName,
  value,
  onChange,
  multi = true,
  onSelectSingle,
  ...pickerProps
}: RecordPickerProps) {
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
  const handleSelectSingle = (recordId: RecordId) => {
    onSelectSingle?.(recordId)
    handleOpenChange(false)
  }

  // Sync internal state with controlled state
  useEffect(() => {
    if (open !== undefined && open !== internalOpen) {
      setInternalOpen(open)
    }
  }, [open])

  /**
   * Format the button label based on selection
   */
  const getButtonLabel = () => {
    if (value.length === 0) {
      return emptyLabel
    }
    if (value.length === 1) {
      return '1 linked record'
    }
    return `${value.length} linked records`
  }

  // Custom trigger or default button
  const triggerElement = children ? (
    children
  ) : (
    <Button
      variant='ghost'
      size='sm'
      className={cn('gap-1', triggerClassName)}
      disabled={pickerProps.disabled}>
      <Link2 />
      {getButtonLabel()}
    </Button>
  )

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{triggerElement}</PopoverTrigger>
      <PopoverContent
        className={cn('w-72 p-0', contentClassName)}
        align={align}
        side={side}
        sideOffset={sideOffset}>
        <RecordPickerContent
          value={value}
          onChange={onChange}
          multi={multi}
          onSelectSingle={multi ? undefined : handleSelectSingle}
          {...pickerProps}
        />
      </PopoverContent>
    </Popover>
  )
}
