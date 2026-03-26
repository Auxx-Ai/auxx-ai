// apps/web/src/components/workflow/ui/editor-height-resize-wrap.tsx

'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import React, { useCallback, useEffect, useRef, useState } from 'react'

interface EditorHeightResizeWrapProps {
  className?: string
  height: number
  minHeight: number
  onHeightChange: (height: number) => void
  children: React.ReactNode
  footer?: React.ReactNode
  hideResize?: boolean
  /** Skip ScrollArea wrapping (e.g. Monaco manages its own scroll) */
  nativeScroll?: boolean
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
  nativeScroll,
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
    <div className='relative'>
      <div
        className={cn('flex min-h-0 flex-1', nativeScroll && 'overflow-y-auto', className)}
        style={{ height }}>
        {nativeScroll ? (
          children
        ) : (
          <ScrollArea
            className='h-full w-full'
            fadeClassName=''
            allowScrollChaining
            scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'>
            {children}
          </ScrollArea>
        )}
      </div>

      {/* Footer content */}
      {footer}

      {/* Resize handler */}
      {!hideResize && (
        <div
          className='group absolute bottom-0 left-0 flex h-3 w-full cursor-row-resize items-center justify-center hover:bg-accent/10'
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
