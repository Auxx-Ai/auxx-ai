// packages/ui/src/components/panel-resize-handle.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useState } from 'react'

interface PanelResizeHandleProps {
  /** Current width of the panel being resized */
  currentWidth: number
  /** Callback when width changes via drag */
  onWidthChange?: (width: number) => void
  /** Minimum allowed width in pixels */
  minWidth?: number
  /** Maximum allowed width in pixels */
  maxWidth?: number
  /**
   * Which side of the handle the resizable panel is on.
   * - `'right'` (default): panel is to the right, dragging left increases width
   * - `'left'`: panel is to the left, dragging right increases width
   */
  side?: 'left' | 'right'
  /** Called when resize drag starts */
  onResizeStart?: () => void
  /** Called when resize drag ends */
  onResizeEnd?: () => void
}

function PanelResizeHandle({
  currentWidth,
  onWidthChange,
  minWidth = 350,
  maxWidth = 800,
  side = 'right',
  onResizeStart,
  onResizeEnd,
}: PanelResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!onWidthChange) return
      e.preventDefault()
      setIsDragging(true)
      onResizeStart?.()

      const startX = e.clientX
      const startWidth = currentWidth

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = side === 'right' ? startX - moveEvent.clientX : moveEvent.clientX - startX
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + deltaX))
        onWidthChange(newWidth)
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        onResizeEnd?.()
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [currentWidth, onWidthChange, minWidth, maxWidth, side]
  )

  return (
    <div
      className={cn(
        'w-2 shrink-0 cursor-ew-resize flex items-center justify-center group',
        !onWidthChange && 'cursor-default'
      )}
      onMouseDown={onWidthChange ? handleMouseDown : undefined}>
      <div
        className={cn(
          'w-1 h-12 rounded-full transition-colors',
          onWidthChange && 'bg-primary-200 group-hover:bg-primary-400',
          isDragging && 'bg-primary-500'
        )}
      />
    </div>
  )
}

export { PanelResizeHandle, type PanelResizeHandleProps }
