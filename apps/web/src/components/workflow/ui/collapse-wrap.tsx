// apps/web/src/components/workflow/ui/collapse-wrap.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import React, { useCallback, useEffect, useRef, useState } from 'react'

interface CollapseWrapProps {
  /** The collapsed height - also the threshold for showing the button */
  minHeight: number
  children: React.ReactNode
  className?: string
  /** Controlled collapsed state */
  isCollapsed?: boolean
  /** Callback when collapsed state changes */
  onCollapsedChange?: (collapsed: boolean) => void
}

/**
 * Collapsible wrapper component that shows collapse/expand controls
 * when content exceeds minHeight. Supports both controlled and uncontrolled modes.
 */
const CollapseWrap: React.FC<CollapseWrapProps> = ({
  minHeight,
  children,
  className,
  isCollapsed: controlledCollapsed,
  onCollapsedChange,
}) => {
  const measureRef = useRef<HTMLDivElement>(null)
  const [naturalHeight, setNaturalHeight] = useState(0)
  const [internalCollapsed, setInternalCollapsed] = useState(false)

  /** Support both controlled and uncontrolled modes */
  const isCollapsed = controlledCollapsed ?? internalCollapsed

  /** Whether content exceeds minHeight and button should be shown */
  const showButton = naturalHeight > minHeight

  /** Toggle collapsed state */
  const handleToggle = useCallback(() => {
    const newValue = !isCollapsed
    if (onCollapsedChange) {
      onCollapsedChange(newValue)
    } else {
      setInternalCollapsed(newValue)
    }
  }, [isCollapsed, onCollapsedChange])

  /** Measure natural height from inner wrapper (unconstrained) */
  useEffect(() => {
    const element = measureRef.current
    if (!element) return

    const updateHeight = () => {
      setNaturalHeight(element.scrollHeight)
    }

    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return (
    <div className='relative'>
      {/* Outer container with maxHeight constraint */}
      <div
        className={cn(
          'overflow-hidden transition-[max-height] duration-200 ease-in-out',
          className
        )}
        style={{ maxHeight: isCollapsed ? minHeight : naturalHeight || 'none' }}>
        {/* Inner wrapper for measuring - no constraints */}
        <div ref={measureRef}>{children}</div>

        {/* Gradient mask overlay when collapsed */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-white/80 dark:from-black/20 to-transparent transition-opacity duration-500',
            isCollapsed && showButton ? 'opacity-100' : 'opacity-0'
          )}
        />
      </div>

      {/* Full-width bottom click area - only shown when content > minHeight */}
      {showButton && (
        <div
          className='group absolute bottom-0 left-0 z-12 flex h-5 w-full translate-y-1/2 cursor-pointer items-center justify-center hover:bg-accent/10'
          onClick={handleToggle}>
          <div className='flex items-center gap-1 rounded-xl border bg-primary-100 px-1.5 py-0.5 text-[10px] text-normal text-muted-foreground transition-colors group-hover:text-foreground'>
            <span>{isCollapsed ? 'Expand' : 'Collapse'}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default React.memo(CollapseWrap)
