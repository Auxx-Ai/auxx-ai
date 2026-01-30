// apps/web/src/components/pickers/actor-picker/actor-picker.tsx

'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode, type RefObject } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContentDialogAware,
  PopoverTrigger,
} from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { ActorPickerContent, type ActorPickerContentProps } from './actor-picker-content'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { ItemsListView } from '~/components/ui/items-list-view'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
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

  /** External anchor ref - popover anchors to this element instead of trigger */
  anchorRef?: RefObject<HTMLElement | null>

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

  /** Trigger customization options */
  triggerProps?: PickerTriggerOptions
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
  anchorRef,
  emptyLabel = 'Select...',
  align = 'start',
  side = 'bottom',
  sideOffset = 5,
  contentClassName,
  triggerProps,
  value,
  onChange,
  multi = true,
  onSelectSingle,
  disabled,
  ...pickerProps
}: ActorPickerProps) {
  // Internal open state (for uncontrolled mode)
  const [internalOpen, setInternalOpen] = useState(false)

  // Ref for content to focus input when using anchorRef
  const contentRef = useRef<HTMLDivElement>(null)

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

  /**
   * Clear all selections
   */
  const handleClearAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onChange([])
    },
    [onChange]
  )

  // Sync internal state with controlled state
  useEffect(() => {
    if (open !== undefined && open !== internalOpen) {
      setInternalOpen(open)
    }
  }, [open])

  const hasValue = value.length > 0

  // Custom trigger or default button using PickerTrigger
  const triggerElement = children ? (
    children
  ) : (
    <PickerTrigger
      open={isOpen}
      disabled={disabled}
      variant={triggerProps?.variant ?? 'transparent'}
      hasValue={hasValue}
      placeholder={emptyLabel}
      showClear={triggerProps?.showClear ?? false}
      onClear={handleClearAll}
      hideIcon={triggerProps?.hideIcon}
      className={triggerProps?.className}>
      <ItemsListView
        items={value}
        renderItem={(item) => <ActorBadge actorId={item as ActorId} />}
      />
    </PickerTrigger>
  )

  // When anchorRef is provided (e.g., from ActionBar overflow), anchor to it
  // Otherwise use the trigger element
  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      {anchorRef ? (
        <PopoverAnchor virtualRef={anchorRef} />
      ) : (
        <PopoverTrigger asChild>{triggerElement}</PopoverTrigger>
      )}
      <PopoverContentDialogAware
        ref={contentRef}
        className={cn('w-72 p-0', contentClassName)}
        align={align}
        side={side}
        sideOffset={sideOffset}
        onOpenAutoFocus={(e) => {
          // Prevent default focus behavior when using anchorRef, then focus the input manually
          if (anchorRef) {
            e.preventDefault()
            requestAnimationFrame(() => {
              const input = contentRef.current?.querySelector('input')
              input?.focus()
            })
          }
        }}
        onFocusOutside={(e) => {
          // Prevent closing on focus changes when using anchorRef
          if (anchorRef) e.preventDefault()
        }}>
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
