// apps/web/src/components/editor/inline-picker/ui/inline-picker-popover.tsx

'use client'

import React, { useRef, useEffect, useState } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import type { InlinePickerPopoverProps } from '../types'

/**
 * Positioned popover for inline picker content.
 * Calculates position relative to the container based on cursor position.
 *
 * Features:
 * - Auto-focuses the search input (cmdk-input) when opened
 * - Handles Escape key to close the popover
 * - Prevents editor blur on mouse interactions
 */
export function InlinePickerPopover({
  state,
  containerRef,
  children,
  className,
  width = 280,
  onClose,
  autoFocus = true,
}: InlinePickerPopoverProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Calculate position when state changes
  useEffect(() => {
    if (state.isOpen && state.clientRect && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect()
      const cursorRect = state.clientRect

      // Position below cursor, aligned to left of trigger
      setPosition({
        top: cursorRect.bottom - containerRect.top + 4, // 4px gap
        left: Math.max(0, cursorRect.left - containerRect.left),
      })
    } else {
      setPosition(null)
    }
  }, [state.isOpen, state.clientRect, containerRef])

  // Auto-focus the command input when popover opens
  // useEffect(() => {
  //   if (state.isOpen && autoFocus && popoverRef.current) {
  //     // Small delay to ensure content is rendered
  //     const timer = setTimeout(() => {
  //       const input = popoverRef.current?.querySelector<HTMLInputElement>('[cmdk-input]')
  //       input?.focus()
  //     }, 10)
  //     return () => clearTimeout(timer)
  //   }
  // }, [state.isOpen, autoFocus])

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose?.()
    }
  }

  // Don't render if not open or no position
  if (!state.isOpen || !position) return null

  return (
    <div
      ref={popoverRef}
      className={cn('absolute z-50 rounded-md border bg-popover shadow-md', className)}
      style={{
        top: position.top,
        left: position.left,
        width: width === 'auto' ? 'auto' : width,
        maxHeight: 300,
        overflow: 'auto',
      }}
      onMouseDown={(e) => e.preventDefault()} // Prevent editor blur
      onKeyDown={handleKeyDown}>
      {children}
    </div>
  )
}
