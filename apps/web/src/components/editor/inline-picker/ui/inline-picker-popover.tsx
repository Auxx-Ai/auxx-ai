// apps/web/src/components/editor/inline-picker/ui/inline-picker-popover.tsx

'use client'

import React, { useRef } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import {
  Popover,
  PopoverAnchor,
  PopoverContentDialogAware,
} from '@auxx/ui/components/popover'
import type { InlinePickerPopoverProps } from '../types'

/**
 * Positioned popover for inline picker content.
 * Uses Radix Popover with virtual anchor to escape overflow constraints.
 *
 * Features:
 * - Renders via portal (body or dialog portal container)
 * - Uses virtual ref for positioning (works inside CSS transforms)
 * - Auto-focuses the command input when opened
 * - Handles Escape key to close the popover
 * - Prevents editor blur on mouse interactions
 */
export function InlinePickerPopover({
  state,
  children,
  className,
  width = 280,
  onClose,
  autoFocus = true,
}: InlinePickerPopoverProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  // Cache the last valid clientRect to prevent position jump on close
  const lastRectRef = useRef<DOMRect>(new DOMRect())

  // Update cached rect when we have a valid one
  if (state.clientRect) {
    lastRectRef.current = state.clientRect
  }

  // Virtual anchor ref that returns cursor position
  // Uses cached rect to maintain position during close animation
  const virtualRef = useRef({
    getBoundingClientRect: () => lastRectRef.current,
  })

  // Focus the command input when popover opens
  const handleOpenAutoFocus = (e: Event) => {
    // Prevent default focus behavior - we handle it manually
    e.preventDefault()

    if (!autoFocus) return

    // Use RAF to ensure content is fully rendered
    requestAnimationFrame(() => {
      const input = contentRef.current?.querySelector<HTMLInputElement>('[cmdk-input]')
      console.log('[InlinePickerPopover] onOpenAutoFocus', {
        foundInput: !!input,
        hasContentRef: !!contentRef.current,
        activeElement: document.activeElement?.tagName,
      })
      if (input) {
        input.focus()
        console.log('[InlinePickerPopover] Called input.focus()', {
          nowActiveElement: document.activeElement?.tagName,
          isSameAsInput: document.activeElement === input,
        })
      }
    })
  }

  // Handle popover close
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose?.()
    }
  }

  // Handle escape key within content
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose?.()
    }
  }

  return (
    <Popover open={state.isOpen} onOpenChange={handleOpenChange}>
      {/* Virtual anchor positioned at cursor - works inside CSS transforms */}
      <PopoverAnchor virtualRef={virtualRef} />

      <PopoverContentDialogAware
        ref={contentRef}
        className={cn('p-0 overflow-hidden', className)}
        style={{ width: width === 'auto' ? 'auto' : width }}
        side="bottom"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={(e) => {
          // Prevent focus returning to trigger (there is no trigger)
          e.preventDefault()
        }}
        onMouseDown={(e) => {
          // Prevent editor blur when clicking in popover
          e.preventDefault()
        }}
        onKeyDown={handleKeyDown}>
        {children}
      </PopoverContentDialogAware>
    </Popover>
  )
}
