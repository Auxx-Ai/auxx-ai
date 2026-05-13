// apps/web/src/components/editor/inline-picker/ui/inline-picker-popover.tsx

'use client'

import { Popover, PopoverAnchor, PopoverContentDialogAware } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { useRef } from 'react'
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
  onTabKey,
  onTabJump,
  containerRef: _containerRef,
  style,
  ...rest
}: InlinePickerPopoverProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  // Cache the last valid clientRect to prevent position jump on close.
  // `DOMRect` doesn't exist on the server — lazy-init on first client paint.
  const lastRectRef = useRef<DOMRect | null>(null)

  // Update cached rect when we have a valid one
  if (state.clientRect) {
    lastRectRef.current = state.clientRect
  } else if (!lastRectRef.current && typeof DOMRect !== 'undefined') {
    lastRectRef.current = new DOMRect()
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
      input?.focus()
    })
  }

  // Handle popover close
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose?.()
    }
  }

  // Handle escape, Tab cycling, Cmd/Ctrl+N tab jumps within content.
  // These are intercepted before cmdk so it doesn't swallow Tab.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose?.()
      return
    }
    if (onTabKey && e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      onTabKey(e.shiftKey ? -1 : 1)
      return
    }
    if (onTabJump && (e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      e.preventDefault()
      e.stopPropagation()
      onTabJump(Number(e.key) - 1)
      return
    }
  }

  return (
    <Popover open={state.isOpen} onOpenChange={handleOpenChange}>
      {/* Virtual anchor positioned at cursor - works inside CSS transforms */}
      <PopoverAnchor virtualRef={virtualRef} />

      <PopoverContentDialogAware
        sideOffset={4}
        {...rest}
        ref={contentRef}
        className={cn('p-0 overflow-hidden', className)}
        style={{ width: width === 'auto' ? 'auto' : width, ...style }}
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
