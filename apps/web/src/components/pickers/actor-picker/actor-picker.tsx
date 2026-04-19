// apps/web/src/components/pickers/actor-picker/actor-picker.tsx

'use client'

import type { ActorId } from '@auxx/types/actor'
import {
  Popover,
  PopoverAnchor,
  PopoverContentDialogAware,
  PopoverTrigger,
} from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { ItemsListView } from '~/components/ui/items-list-view'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import {
  ActorPickerContent,
  type ActorPickerContentProps,
  CURRENT_USER_ACTOR_ID,
} from './actor-picker-content'

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

  /** Callback to check if a dismiss event should be prevented. Return true to prevent closing. */
  shouldPreventDismiss?: (target: HTMLElement) => boolean
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
  shouldPreventDismiss,
  value,
  onChange,
  multi = true,
  onSelectSingle,
  disabled,
  ...pickerProps
}: ActorPickerProps) {
  // Normalize value — callers may pass a single string when switching operators
  const normalizedValue = Array.isArray(value) ? value : value ? [value] : []

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: internalOpen is intentionally excluded to avoid infinite loop
  useEffect(() => {
    if (open !== undefined && open !== internalOpen) {
      setInternalOpen(open)
    }
  }, [open])

  const hasValue = normalizedValue.length > 0

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
        items={normalizedValue}
        renderItem={(item) =>
          item === CURRENT_USER_ACTOR_ID ? (
            <span className='rounded-md bg-primary-200/60 px-1.5 py-0.5 text-xs font-medium text-primary-700'>
              Current user
            </span>
          ) : (
            <ActorBadge actorId={item as ActorId} size={triggerProps?.badgeSize} />
          )
        }
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
          if (anchorRef || shouldPreventDismiss?.(e.target as HTMLElement)) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (shouldPreventDismiss?.(e.target as HTMLElement)) e.preventDefault()
        }}>
        <ActorPickerContent
          value={normalizedValue}
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
