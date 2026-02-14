// packages/ui/src/components/overflow-row.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/** Props for the OverflowRow component */
interface OverflowRowProps {
  children: ReactNode
  /** data-slot value to hide when item is collapsed (default: "text") */
  collapseSlot?: string
  /** Custom overflow indicator render function */
  renderOverflow?: (count: number) => ReactNode
  /** Gap between items in pixels (default: 4) */
  gap?: number
  className?: string
}

/** Approximate width of the default "+N" overflow badge */
const OVERFLOW_BADGE_WIDTH = 36

/**
 * Calculates which items should be collapsed or hidden based on available width.
 * Uses a greedy left-to-right algorithm: try full width -> collapsed width -> hidden.
 */
function useOverflowLayout(
  containerWidth: number,
  fullWidths: number[],
  collapsedWidths: number[],
  gap: number
): { collapsedIndices: Set<number>; hiddenStartIndex: number } {
  return useMemo(() => {
    const count = fullWidths.length
    if (count === 0 || containerWidth === 0) {
      return { collapsedIndices: new Set<number>(), hiddenStartIndex: count }
    }

    // Check if everything fits at full width
    const totalFull = fullWidths.reduce((sum, w) => sum + w, 0) + (count - 1) * gap
    if (totalFull <= containerWidth) {
      return { collapsedIndices: new Set<number>(), hiddenStartIndex: count }
    }

    // Greedy left-to-right: try full -> collapsed -> hidden
    const collapsedIndices = new Set<number>()
    let usedWidth = 0
    let hiddenStartIndex = count

    for (let i = 0; i < count; i++) {
      const fullW = fullWidths[i] ?? 0
      const collapsedW = collapsedWidths[i] ?? fullW
      const gapW = i > 0 ? gap : 0

      // Reserve space for overflow badge if more items remain
      const remaining = count - i - 1
      const reserve = remaining > 0 ? OVERFLOW_BADGE_WIDTH + gap : 0
      const available = containerWidth - usedWidth - reserve

      // Try full width first
      if (fullW + gapW <= available) {
        usedWidth += fullW + gapW
        continue
      }

      // Try collapsed width (only if smaller than full)
      if (collapsedW < fullW && collapsedW + gapW <= available) {
        collapsedIndices.add(i)
        usedWidth += collapsedW + gapW
        continue
      }

      // Can't fit - hide this and all remaining items
      hiddenStartIndex = i
      break
    }

    return { collapsedIndices, hiddenStartIndex }
  }, [containerWidth, fullWidths, collapsedWidths, gap])
}

/**
 * A horizontal row that intelligently handles overflow by:
 * 1. First collapsing items (hiding elements matching collapseSlot)
 * 2. Then hiding items entirely with a "+N" indicator
 *
 * Children should use data-slot attributes to mark collapsible content.
 * Example: <span data-slot="text">Label</span>
 */
export function OverflowRow({
  children,
  collapseSlot = 'text',
  renderOverflow,
  gap = 4,
  className,
}: OverflowRowProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fullMeasureRef = useRef<HTMLDivElement>(null)
  const collapsedMeasureRef = useRef<HTMLDivElement>(null)

  const [containerWidth, setContainerWidth] = useState(0)
  const [fullWidths, setFullWidths] = useState<number[]>([])
  const [collapsedWidths, setCollapsedWidths] = useState<number[]>([])

  const childArray = useMemo(
    () => Children.toArray(children).filter(isValidElement) as ReactElement[],
    [children]
  )

  // Measure container width with heavy debounce (only update when resize stops)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let currentWidth = 0
    let timeoutId: NodeJS.Timeout | null = null

    const observer = new ResizeObserver((entries) => {
      const newWidth = Math.floor(entries[0]?.contentRect.width ?? 0)
      if (newWidth === currentWidth) return
      currentWidth = newWidth

      // Debounce: only commit after 200ms of no changes
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        setContainerWidth(newWidth)
      }, 200)
    })

    observer.observe(el)

    // Initial measurement (immediate)
    const initial = Math.floor(el.getBoundingClientRect().width)
    currentWidth = initial
    setContainerWidth(initial)

    return () => {
      observer.disconnect()
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  // Measure child widths once on mount and when children change
  useLayoutEffect(() => {
    const fullContainer = fullMeasureRef.current
    const collapsedContainer = collapsedMeasureRef.current

    if (fullContainer) {
      const widths = Array.from(fullContainer.children).map((el) => (el as HTMLElement).offsetWidth)
      setFullWidths((prev) => {
        if (prev.length !== widths.length || prev.some((w, i) => w !== widths[i])) {
          return widths
        }
        return prev
      })
    }

    if (collapsedContainer) {
      const widths = Array.from(collapsedContainer.children).map(
        (el) => (el as HTMLElement).offsetWidth
      )
      setCollapsedWidths((prev) => {
        if (prev.length !== widths.length || prev.some((w, i) => w !== widths[i])) {
          return widths
        }
        return prev
      })
    }
  }, [childArray.length])

  const { collapsedIndices, hiddenStartIndex } = useOverflowLayout(
    containerWidth,
    fullWidths,
    collapsedWidths,
    gap
  )

  // Early return if no children - render nothing
  if (childArray.length === 0) {
    return null
  }

  const overflowCount = childArray.length - hiddenStartIndex

  /** Default overflow indicator badge */
  const defaultOverflow = (count: number) => (
    <span className='inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded-md border bg-muted text-muted-foreground shrink-0'>
      +{count}
    </span>
  )

  // CSS to hide the collapsible slot - injected via style tag for reliability
  const collapseStyle = `[data-overflow-collapsed] [data-slot="${collapseSlot}"] { display: none !important; }`

  return (
    <>
      <style>{collapseStyle}</style>

      {/* Hidden measurement container - full width */}
      <div
        ref={fullMeasureRef}
        aria-hidden='true'
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          display: 'flex',
          gap,
        }}>
        {childArray.map((child, i) => (
          <div key={i}>{child}</div>
        ))}
      </div>

      {/* Hidden measurement container - collapsed (text hidden) */}
      <div
        ref={collapsedMeasureRef}
        data-overflow-collapsed
        aria-hidden='true'
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          display: 'flex',
          gap,
        }}>
        {childArray.map((child, i) => (
          <div key={i}>{child}</div>
        ))}
      </div>

      {/* Wrapper with relative positioning for width measurement */}
      <div className={cn('relative min-w-0 flex-1', className)}>
        {/* Width measurement target */}
        <div ref={containerRef} className='absolute inset-0 pointer-events-none' aria-hidden />

        {/* Visible container */}
        <div className='flex items-center  justify-end' style={{ gap }}>
          {childArray.map((child, i) => {
            if (i >= hiddenStartIndex) return null

            const isCollapsed = collapsedIndices.has(i)
            return (
              <div key={i} data-overflow-collapsed={isCollapsed || undefined}>
                {child}
              </div>
            )
          })}
          {overflowCount > 0 && (renderOverflow ?? defaultOverflow)(overflowCount)}
        </div>
      </div>
    </>
  )
}
