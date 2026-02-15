// apps/web/src/components/pickers/resource-picker/resource-picker.tsx

'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import {
  Popover,
  PopoverAnchor,
  PopoverContentDialogAware,
  PopoverTrigger,
} from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useResources } from '~/components/resources/hooks/use-resources'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { ResourcePickerContent } from './resource-picker-content'
import type { ResourcePickerProps } from './types'

/**
 * ResourcePicker - A popover wrapper around ResourcePickerContent.
 * Provides a complete dropdown experience for selecting resources.
 *
 * Features:
 * - Custom trigger support via children
 * - Default trigger showing selected resource icon + label
 * - Controlled or uncontrolled open state
 * - Auto-close on single select
 */
export function ResourcePicker({
  children,
  open,
  onOpenChange,
  anchorRef,
  emptyLabel = 'Select resource...',
  align = 'start',
  side = 'bottom',
  sideOffset = 5,
  contentClassName,
  triggerProps,
  value,
  onChange,
  multi = false,
  onSelectSingle,
  disabled,
  ...pickerProps
}: ResourcePickerProps) {
  // Internal open state (for uncontrolled mode)
  const [internalOpen, setInternalOpen] = useState(false)

  // Ref for content to focus input when using anchorRef
  const contentRef = useRef<HTMLDivElement>(null)

  // Use controlled or uncontrolled state
  const isOpen = open ?? internalOpen

  // Get resources to resolve selected value for display
  const { getResourceById } = useResources()

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
  const handleSelectSingle = (id: string) => {
    onSelectSingle?.(id)
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

  const hasValue = value.length > 0

  // Resolve the selected resource for display in the trigger
  const selectedResource = hasValue ? getResourceById(value[0]) : undefined

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
      {selectedResource && (
        <div className='flex items-center gap-2 min-w-0'>
          <EntityIcon
            iconId={selectedResource.icon ?? 'circle'}
            color={selectedResource.color ?? 'gray'}
            size='sm'
            inverse
            className='inset-shadow-xs inset-shadow-black/20'
          />
          <span className='truncate text-sm'>{selectedResource.label}</span>
        </div>
      )}
    </PickerTrigger>
  )

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
        <ResourcePickerContent
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
