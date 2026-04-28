// packages/ui/src/components/smart-breadcrumb.tsx

'use client'

import { useContainerWidth } from '@auxx/ui/hooks/use-container-width'
import { measureTextWidths, truncateText } from '@auxx/ui/lib/measure-text'
import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronRight, ChevronsRight, type LucideIcon, MoreHorizontal } from 'lucide-react'
import * as React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'

/** CVA variants for the breadcrumb container */
const smartBreadcrumbVariants = cva(
  'flex items-center text-muted-foreground overflow-hidden min-w-0 ',
  {
    variants: {
      size: {
        sm: 'h-5 gap-1 text-xs',
        default: 'h-8 gap-1.5 text-sm',
        lg: 'h-10 gap-2 text-base',
      },
    },
    defaultVariants: { size: 'default' },
  }
)

/** CVA variants for individual segments */
const segmentVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap transition-colors min-w-0',
  {
    variants: {
      interactive: {
        true: 'hover:text-foreground cursor-pointer',
        false: '',
      },
      current: {
        true: 'font-medium text-foreground',
        false: '',
      },
      disabled: {
        true: 'opacity-50 cursor-not-allowed pointer-events-none',
        false: '',
      },
    },
    defaultVariants: {
      interactive: false,
      current: false,
      disabled: false,
    },
  }
)

/** Individual breadcrumb segment */
export interface BreadcrumbSegment {
  /** Unique identifier */
  id: string
  /** Display label */
  label: string
  /** Optional icon before label */
  icon?: LucideIcon
  /** URL for navigation (clickable mode) */
  href?: string
  /** Click handler (clickable mode) */
  onClick?: () => void
  /** Whether disabled */
  disabled?: boolean
}

/** Interaction modes */
export type BreadcrumbInteractionMode = 'display' | 'clickable' | 'dropdown'

/** Component props */
export interface SmartBreadcrumbProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'children'>,
    VariantProps<typeof smartBreadcrumbVariants> {
  /** Path segments to display */
  segments: BreadcrumbSegment[]
  /** Interaction mode */
  mode?: BreadcrumbInteractionMode
  /** Custom separator element */
  separator?: React.ReactNode
  /** Minimum width per segment before truncation (default: 40) */
  minSegmentWidth?: number
  /** Callback when collapsed segment selected from dropdown */
  onCollapsedSegmentClick?: (segment: BreadcrumbSegment) => void
}

/** Internal type for layout calculation */
interface LayoutSegment {
  segment: BreadcrumbSegment
  width: number
  displayLabel: string
  visible: boolean
}

/** Constants for layout calculation */
const SEPARATOR_WIDTH = 20 // Approximate width of chevron + gaps
const ELLIPSIS_BUTTON_WIDTH = 32 // Width of ellipsis button
const MIN_SEGMENT_WIDTH = 40 // Minimum width for a segment

/**
 * Hook to calculate breadcrumb layout based on container width
 */
function useBreadcrumbLayout(
  segments: BreadcrumbSegment[],
  containerWidth: number,
  font: string,
  minSegmentWidth: number
): {
  visibleSegments: LayoutSegment[]
  collapsedSegments: BreadcrumbSegment[]
  useDoubleChevron: boolean
} {
  return React.useMemo(() => {
    if (segments.length === 0) {
      return { visibleSegments: [], collapsedSegments: [], useDoubleChevron: false }
    }

    // Measure all segment labels
    const labels = segments.map((s) => s.label)
    const widths = measureTextWidths(labels, font)

    // Calculate total width needed
    const totalSegmentWidth = widths.reduce((sum, w) => sum + w, 0)
    const totalSeparatorWidth = (segments.length - 1) * SEPARATOR_WIDTH
    const totalNeeded = totalSegmentWidth + totalSeparatorWidth

    // Render all segments unrestricted when:
    //   - Container width hasn't been measured yet (`0` = initial mount or
    //     `display: none` ancestor). Returning empty here would create a
    //     chicken-and-egg: nothing rendered → `<ol>` has 0 content → measured
    //     width stays 0 → never escape. Letting the full layout render lets
    //     `ResizeObserver` see the *actual* content/parent width on the next
    //     tick, after which truncation can kick in if the parent is constrained.
    //   - Everything fits within the measured width.
    if (containerWidth === 0 || totalNeeded <= containerWidth) {
      return {
        visibleSegments: segments.map((segment, i) => ({
          segment,
          width: widths[i] ?? 0,
          displayLabel: segment.label,
          visible: true,
        })),
        collapsedSegments: [],
        useDoubleChevron: false,
      }
    }

    // Need to truncate - prioritize first and last segments
    const firstWidth = widths[0] ?? 0
    const lastWidth = widths[segments.length - 1] ?? 0

    // Single segment - truncate if needed
    if (segments.length === 1) {
      const firstSegment = segments[0]!
      const displayLabel =
        firstWidth > containerWidth
          ? truncateText(firstSegment.label, containerWidth, font)
          : firstSegment.label
      return {
        visibleSegments: [
          { segment: firstSegment, width: firstWidth, displayLabel, visible: true },
        ],
        collapsedSegments: [],
        useDoubleChevron: false,
      }
    }

    // Two segments — render both with their full labels and let CSS handle
    // visual truncation (each segment's `<span class='truncate'>` already has
    // `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`).
    //
    // Why not truncate the strings ourselves? The string-level approach feeds
    // back: `truncateText` cuts at character boundaries so the rendered text
    // is *narrower* than `availableForEach`. When the parent (Badge here) is
    // content-sized — `inline-flex`/`flex` with `max-w`, which is content-
    // driven below the cap — that narrower content shrinks the parent →
    // ResizeObserver fires smaller → tighter target → smaller text → loop.
    // We saw it spiral 168 → 154 → 141 → … → 43.
    //
    // CSS truncation doesn't loop because the box width that the browser
    // truncates against is the layout-assigned width, not the text width
    // post-truncation; once flexbox distributes shrinkage proportionally,
    // the boxes are stable.
    if (segments.length === 2) {
      return {
        visibleSegments: segments.map((segment, i) => ({
          segment,
          width: widths[i] ?? 0,
          displayLabel: segment.label,
          visible: true,
        })),
        collapsedSegments: [],
        useDoubleChevron: false,
      }
    }

    // 3+ segments - collapse middle segments
    // Reserve space: first + ellipsis + last + separators
    const reservedWidth =
      Math.min(firstWidth, Math.max(minSegmentWidth, containerWidth * 0.25)) +
      ELLIPSIS_BUTTON_WIDTH +
      Math.min(lastWidth, Math.max(minSegmentWidth, containerWidth * 0.25)) +
      2 * SEPARATOR_WIDTH

    let remainingWidth = containerWidth - reservedWidth
    const visibleMiddleIndices: number[] = []

    // Work backwards from second-to-last, adding segments while space allows
    for (let i = segments.length - 2; i >= 1; i--) {
      const segmentWidth = (widths[i] ?? 0) + SEPARATOR_WIDTH
      if (segmentWidth <= remainingWidth) {
        visibleMiddleIndices.unshift(i)
        remainingWidth -= segmentWidth
      } else {
        break
      }
    }

    // Build collapsed segments list (those not visible)
    const collapsedIndices = new Set<number>()
    for (let i = 1; i < segments.length - 1; i++) {
      if (!visibleMiddleIndices.includes(i)) {
        collapsedIndices.add(i)
      }
    }

    const collapsedSegments = segments.filter((_, i) => collapsedIndices.has(i))
    const useDoubleChevron = collapsedSegments.length > 0

    // Get first and last segments (safe because we've checked length >= 3)
    const firstSegment = segments[0]!
    const lastSegment = segments[segments.length - 1]!

    // Calculate first segment display width
    const firstAvailableWidth = Math.min(
      firstWidth,
      Math.max(minSegmentWidth, containerWidth * 0.3)
    )
    const firstDisplayLabel =
      firstWidth > firstAvailableWidth
        ? truncateText(firstSegment.label, firstAvailableWidth, font)
        : firstSegment.label

    // Calculate last segment display width
    const lastAvailableWidth = Math.min(lastWidth, Math.max(minSegmentWidth, containerWidth * 0.3))
    const lastDisplayLabel =
      lastWidth > lastAvailableWidth
        ? truncateText(lastSegment.label, lastAvailableWidth, font)
        : lastSegment.label

    // Build visible segments array
    const visibleSegments: LayoutSegment[] = [
      { segment: firstSegment, width: firstWidth, displayLabel: firstDisplayLabel, visible: true },
    ]

    // Add visible middle segments
    for (const i of visibleMiddleIndices) {
      const seg = segments[i]
      if (seg) {
        visibleSegments.push({
          segment: seg,
          width: widths[i] ?? 0,
          displayLabel: seg.label,
          visible: true,
        })
      }
    }

    // Add last segment
    visibleSegments.push({
      segment: lastSegment,
      width: lastWidth,
      displayLabel: lastDisplayLabel,
      visible: true,
    })

    return { visibleSegments, collapsedSegments, useDoubleChevron }
  }, [segments, containerWidth, font, minSegmentWidth])
}

/**
 * Renders an individual breadcrumb segment
 */
function SmartBreadcrumbSegment({
  segment,
  displayLabel,
  mode,
  isCurrent,
  className,
}: {
  segment: BreadcrumbSegment
  displayLabel: string
  mode: BreadcrumbInteractionMode
  isCurrent: boolean
  className?: string
}) {
  const Icon = segment.icon
  const isInteractive = mode !== 'display' && !isCurrent && (segment.href || segment.onClick)

  const content = (
    <>
      {Icon && <Icon className='size-3.5 shrink-0' />}
      <span className='truncate'>{displayLabel}</span>
    </>
  )

  const baseClassName = cn(
    segmentVariants({
      interactive: !!isInteractive,
      current: isCurrent,
      disabled: segment.disabled,
    }),
    className
  )

  // Current page - always a span
  if (isCurrent) {
    return (
      <span role='link' aria-disabled='true' aria-current='page' className={baseClassName}>
        {content}
      </span>
    )
  }

  // Display mode or no interaction - span
  if (mode === 'display' || (!segment.href && !segment.onClick)) {
    return <span className={baseClassName}>{content}</span>
  }

  // Clickable with href - anchor
  if (segment.href) {
    return (
      <a
        href={segment.href}
        className={baseClassName}
        onClick={segment.disabled ? (e) => e.preventDefault() : segment.onClick}>
        {content}
      </a>
    )
  }

  // Clickable with onClick - button
  return (
    <button
      type='button'
      className={baseClassName}
      onClick={segment.onClick}
      disabled={segment.disabled}>
      {content}
    </button>
  )
}

/**
 * Renders the ellipsis button with optional dropdown
 */
function SmartBreadcrumbEllipsis({
  collapsedSegments,
  mode,
  onSegmentClick,
}: {
  collapsedSegments: BreadcrumbSegment[]
  mode: BreadcrumbInteractionMode
  onSegmentClick?: (segment: BreadcrumbSegment) => void
}) {
  const buttonContent = (
    <span className='flex size-6 items-center justify-center rounded-md hover:bg-accent/50 transition-colors'>
      <MoreHorizontal className='size-4' />
      <span className='sr-only'>Show {collapsedSegments.length} more items</span>
    </span>
  )

  // Display mode - just show ellipsis icon
  if (mode === 'display') {
    return (
      <span role='presentation' aria-hidden='true'>
        {buttonContent}
      </span>
    )
  }

  // Clickable mode without dropdown - just ellipsis
  if (mode === 'clickable') {
    return (
      <span role='presentation' aria-hidden='true'>
        {buttonContent}
      </span>
    )
  }

  // Dropdown mode - show menu with collapsed items
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          className='focus:outline-none'
          aria-label='Show hidden breadcrumb items'>
          {buttonContent}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {collapsedSegments.map((segment) => {
          const Icon = segment.icon
          return (
            <DropdownMenuItem
              key={segment.id}
              disabled={segment.disabled}
              onClick={() => {
                if (segment.onClick) segment.onClick()
                if (onSegmentClick) onSegmentClick(segment)
              }}>
              {Icon && <Icon className='size-4' />}
              {segment.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Renders a separator between segments
 */
function SmartBreadcrumbSeparator({
  useDouble,
  custom,
}: {
  useDouble?: boolean
  custom?: React.ReactNode
}) {
  if (custom) {
    return (
      <li role='presentation' aria-hidden='true' className='[&>svg]:size-3.5'>
        {custom}
      </li>
    )
  }

  const Icon = useDouble ? ChevronsRight : ChevronRight

  return (
    <li role='presentation' aria-hidden='true' className='[&>svg]:size-3.5 shrink-0'>
      <Icon />
    </li>
  )
}

/**
 * Smart breadcrumb component that intelligently truncates path segments
 * based on available container width, prioritizing first and last segments.
 */
export function SmartBreadcrumb({
  segments,
  mode = 'display',
  separator,
  minSegmentWidth = MIN_SEGMENT_WIDTH,
  onCollapsedSegmentClick,
  size,
  className,
  ...props
}: SmartBreadcrumbProps) {
  const [containerRef, containerWidth] = useContainerWidth<HTMLOListElement>()
  const [font, setFont] = React.useState('14px sans-serif')

  // Extract font from container element. The `font` shorthand returns `''`
  // in most browsers, so always build from longhand properties to avoid
  // silently falling through to the `'14px sans-serif'` default — which
  // over-measures `text-xs` (12px) by ~17% and forces premature truncation.
  React.useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const cs = getComputedStyle(element)
    const fontStyle = cs.getPropertyValue('font-style') || 'normal'
    const fontWeight = cs.getPropertyValue('font-weight') || '400'
    const fontSize = cs.getPropertyValue('font-size') || '14px'
    const fontFamily = cs.getPropertyValue('font-family') || 'sans-serif'
    setFont(`${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`)
  }, [containerRef])

  const { visibleSegments, collapsedSegments, useDoubleChevron } = useBreadcrumbLayout(
    segments,
    containerWidth,
    font,
    minSegmentWidth
  )

  // Empty state
  if (segments.length === 0) {
    return null
  }

  return (
    <nav aria-label='breadcrumb' className={cn('min-w-0 flex-auto', className)} {...props}>
      <ol
        ref={containerRef}
        data-slot='breadcrumb-list'
        className={cn(smartBreadcrumbVariants({ size }))}>
        {visibleSegments.map((item, index) => {
          const isFirst = index === 0
          const isLast = index === visibleSegments.length - 1
          const showEllipsis = isFirst && collapsedSegments.length > 0

          return (
            <React.Fragment key={item.segment.id}>
              {/* Segment */}
              <li className='inline-flex items-center min-w-0'>
                <SmartBreadcrumbSegment
                  segment={item.segment}
                  displayLabel={item.displayLabel}
                  mode={mode}
                  isCurrent={isLast}
                />
              </li>

              {/* Separator after first segment (before ellipsis) */}
              {showEllipsis && <SmartBreadcrumbSeparator custom={separator} />}

              {/* Ellipsis for collapsed segments */}
              {showEllipsis && (
                <li className='inline-flex items-center'>
                  <SmartBreadcrumbEllipsis
                    collapsedSegments={collapsedSegments}
                    mode={mode}
                    onSegmentClick={onCollapsedSegmentClick}
                  />
                </li>
              )}

              {/* Separator after segment (or after ellipsis) */}
              {!isLast && (
                <SmartBreadcrumbSeparator
                  useDouble={showEllipsis && useDoubleChevron}
                  custom={separator}
                />
              )}
            </React.Fragment>
          )
        })}
      </ol>
    </nav>
  )
}

export { smartBreadcrumbVariants }
