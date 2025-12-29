// apps/web/src/components/workflow/ui/editor-height-resize-wrap.tsx

'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@auxx/ui/lib/utils'

interface EditorHeightResizeWrapProps {
  className?: string
  height: number
  minHeight: number
  onHeightChange: (height: number) => void
  children: React.ReactNode
  footer?: React.ReactNode
  hideResize?: boolean
}

/** Stores drag state to avoid stale closures in event handlers */
interface DragState {
  startY: number
  startHeight: number
  prevUserSelect: string
}

/**
 * Reusable height resize wrapper component
 * Allows manual resizing of editor height with mouse drag
 */
const EditorHeightResizeWrap: React.FC<EditorHeightResizeWrapProps> = ({
  className,
  height,
  minHeight,
  onHeightChange,
  children,
  footer,
  hideResize,
}) => {
  const dragStateRef = useRef<DragState | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  /** Handles mouse movement during resize - only active when dragging */
  const handleResize = useCallback(
    (e: MouseEvent) => {
      const state = dragStateRef.current
      if (!state) return

      const offset = e.clientY - state.startY
      const newHeight = Math.max(state.startHeight + offset, minHeight)
      onHeightChange(newHeight)
    },
    [minHeight, onHeightChange]
  )

  /** Stops resize and removes event listeners */
  const handleStopResize = useCallback(() => {
    const state = dragStateRef.current
    if (!state) return

    document.body.style.userSelect = state.prevUserSelect
    document.removeEventListener('mousemove', handleResize)
    document.removeEventListener('mouseup', handleStopResize)
    dragStateRef.current = null
    setIsResizing(false)
  }, [handleResize])

  /** Starts resize and attaches event listeners */
  const handleStartResize = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      dragStateRef.current = {
        startY: e.clientY,
        startHeight: height,
        prevUserSelect: getComputedStyle(document.body).userSelect,
      }
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', handleStopResize)
      setIsResizing(true)
    },
    [height, handleResize, handleStopResize]
  )

  /** Cleanup on unmount */
  useEffect(() => {
    return () => {
      if (dragStateRef.current) {
        document.removeEventListener('mousemove', handleResize)
        document.removeEventListener('mouseup', handleStopResize)
      }
    }
  }, [handleResize, handleStopResize])

  return (
    <div className="relative">
      <div className={cn('overflow-y-auto flex min-h-0 flex-1', className)} style={{ height }}>
        {children}
      </div>

      {/* Footer content */}
      {footer}

      {/* Resize handler */}
      {!hideResize && (
        <div
          className="group absolute bottom-0 left-0 flex h-3 w-full cursor-row-resize items-center justify-center hover:bg-accent/10"
          onMouseDown={handleStartResize}>
          <div
            className={cn(
              'h-1 w-8 rounded-full bg-border transition-colors group-hover:bg-primary-400/50',
              isResizing && 'bg-primary-400 group-hover:bg-primary-400'
            )}
          />
        </div>
      )}
    </div>
  )
}

export default React.memo(EditorHeightResizeWrap)
