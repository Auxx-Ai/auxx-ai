// packages/ui/src/components/smart-breadcrumb.tsx

'use client'

import { useContainerWidth } from '@auxx/ui/hooks/use-container-width'
import { measureTextWidths } from '@auxx/ui/lib/measure-text'
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
  'flex items-center text-muted-foreground overflow-hidden min-w-0',
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
  /**
   * When set, the rendered `<li>` slot is locked to this exact pixel width via
   * inline `width` style. CSS handles visual truncation via `text-overflow:
   * ellipsis` on the inner span. Only set when natural content exceeds the
   * available container width — otherwise `<li>` sizes to content.
   */
  targetWidth?: number
}

/**
 * Water-fill width distribution: walk segments smallest-to-largest, giving
 * each its natural width capped at the fair share of the remaining budget.
 * Smaller segments stay at natural size; larger segments absorb the deficit.
 */
function distributeWidths(widths: number[], available: number, minWidth: number): number[] {
  const order = widths.map((_, i) => i).sort((a, b) => (widths[a] ?? 0) - (widths[b] ?? 0))
  const targets = new Array<number>(widths.length).fill(0)
  let budget = available
  let remaining = widths.length
  for (const i of order) {
    const fair = Math.max(minWidth, budget / remaining)
    const take = Math.min(widths[i] ?? 0, fair)
    targets[i] = take
    budget -= take
    remaining -= 1
  }
  return targets
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
  containerRef: React.RefObject<HTMLOListElement | null>,
  minSegmentWidth: number
): {
  visibleSegments: LayoutSegment[]
  collapsedSegments: BreadcrumbSegment[]
  useDoubleChevron: boolean
} {
  return React.useMemo(() => {
    // Read the actual computed font live from the DOM at measurement time.
    // Storing in state via useEffect was unreliable here: TipTap remounts the
    // badge on transactions, and the effect's mount-once timing meant the
    // stale default `'14px sans-serif'` got used for measurement —
    // measureText would then over-estimate widths (e.g., "Company Name" at
    // 14px sans-serif = 101px vs actual 12px Inter = 92px), causing
    // distribute() to chase a too-wide target on each ResizeObserver tick
    // until something snapped it back.
    let font = '14px sans-serif'
    const el = containerRef.current
    if (el) {
      const cs = getComputedStyle(el)
      const fontStyle = cs.getPropertyValue('font-style') || 'normal'
      const fontWeight = cs.getPropertyValue('font-weight') || '400'
      const fontSize = cs.getPropertyValue('font-size') || '14px'
      const fontFamily = cs.getPropertyValue('font-family') || 'sans-serif'
      font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`
    }
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

    // First paint (`containerWidth === 0`) and "fits naturally" both render
    // at natural size with no slot-lock. The first-paint case lets the
    // parent (content-sized badges with `max-w` caps, etc.) have actual
    // content to size against. ResizeObserver then fires the real
    // constrained width on the next tick and the truncation branch below
    // kicks in.
    //
    // For ancestors that would otherwise inflate to the breadcrumb's
    // min-content (anything using `min-width: min-content`), the caller
    // must apply `contain: inline-size` to that ancestor — `min-w-0` on
    // flex descendants does NOT cap min-content propagation.
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

    // Need to truncate. Compute fixed per-segment slot widths and let the
    // browser's text-overflow:ellipsis render the visual cut at the slot edge.
    //
    // Why slot widths instead of string-level `truncateText`? When the parent
    // is content-sized (Badge with `max-w`, or `inline-flex` capped below the
    // cap), shrinking the rendered text shrinks the parent, which shrinks the
    // measured container, which tightens the target, which shrinks the text
    // again — a feedback loop we saw spiral 168 → 154 → 141 → … → 43.
    //
    // Locking each `<li>` to a JS-computed pixel width keeps the `<ol>`'s
    // total layout width stable across re-measure cycles: slot sizes derive
    // from `containerWidth`, not from rendered text. CSS truncation inside
    // each slot doesn't feed back because the slot is fixed.
    const firstWidth = widths[0] ?? 0
    const lastWidth = widths[segments.length - 1] ?? 0

    // Single segment - constrain to container width
    if (segments.length === 1) {
      const firstSegment = segments[0]!
      return {
        visibleSegments: [
          {
            segment: firstSegment,
            width: firstWidth,
            displayLabel: firstSegment.label,
            visible: true,
            targetWidth: Math.max(minSegmentWidth, containerWidth),
          },
        ],
        collapsedSegments: [],
        useDoubleChevron: false,
      }
    }

    // Two segments - water-fill distribution
    if (segments.length === 2) {
      const available = Math.max(2 * minSegmentWidth, containerWidth - SEPARATOR_WIDTH)
      const [t0, t1] = distributeWidths([firstWidth, lastWidth], available, minSegmentWidth) as [
        number,
        number,
      ]
      return {
        visibleSegments: [
          {
            segment: segments[0]!,
            width: firstWidth,
            displayLabel: segments[0]!.label,
            visible: true,
            targetWidth: t0,
          },
          {
            segment: segments[1]!,
            width: lastWidth,
            displayLabel: segments[1]!.label,
            visible: true,
            targetWidth: t1,
          },
        ],
        collapsedSegments: [],
        useDoubleChevron: false,
      }
    }

    // 3+ segments - decide which middles to keep, then water-fill across
    // visible segments.
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

    const collapsedIndices = new Set<number>()
    for (let i = 1; i < segments.length - 1; i++) {
      if (!visibleMiddleIndices.includes(i)) collapsedIndices.add(i)
    }

    const collapsedSegments = segments.filter((_, i) => collapsedIndices.has(i))
    const useDoubleChevron = collapsedSegments.length > 0

    const firstSegment = segments[0]!
    const lastSegment = segments[segments.length - 1]!

    // Distribute available width (minus separators and optional ellipsis)
    // across visible segments using water-fill so smaller segments stay at
    // natural size when there's room.
    const visibleNaturalWidths = [
      firstWidth,
      ...visibleMiddleIndices.map((i) => widths[i] ?? 0),
      lastWidth,
    ]
    const numSeparators = visibleNaturalWidths.length - 1 + (useDoubleChevron ? 1 : 0)
    const ellipsisSpace = useDoubleChevron ? ELLIPSIS_BUTTON_WIDTH : 0
    const distributable = Math.max(
      visibleNaturalWidths.length * minSegmentWidth,
      containerWidth - numSeparators * SEPARATOR_WIDTH - ellipsisSpace
    )
    const targets = distributeWidths(visibleNaturalWidths, distributable, minSegmentWidth)

    const visibleSegments: LayoutSegment[] = [
      {
        segment: firstSegment,
        width: firstWidth,
        displayLabel: firstSegment.label,
        visible: true,
        targetWidth: targets[0],
      },
    ]
    visibleMiddleIndices.forEach((i, k) => {
      const seg = segments[i]
      if (seg) {
        visibleSegments.push({
          segment: seg,
          width: widths[i] ?? 0,
          displayLabel: seg.label,
          visible: true,
          targetWidth: targets[k + 1],
        })
      }
    })
    visibleSegments.push({
      segment: lastSegment,
      width: lastWidth,
      displayLabel: lastSegment.label,
      visible: true,
      targetWidth: targets[targets.length - 1],
    })

    return { visibleSegments, collapsedSegments, useDoubleChevron }
    // `containerRef` is a stable ref; the live `getComputedStyle` read above
    // re-runs whenever any other dep changes (which covers ResizeObserver
    // ticks via `containerWidth`).
  }, [segments, containerWidth, containerRef, minSegmentWidth])
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
      <span className='truncate min-w-0'>{displayLabel}</span>
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

  const { visibleSegments, collapsedSegments, useDoubleChevron } = useBreadcrumbLayout(
    segments,
    containerWidth,
    containerRef,
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
              <li
                className='inline-flex items-center min-w-0'
                style={
                  item.targetWidth != null
                    ? { width: `${Math.floor(item.targetWidth)}px`, flexShrink: 0 }
                    : undefined
                }>
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
