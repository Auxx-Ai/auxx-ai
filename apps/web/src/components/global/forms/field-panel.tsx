// apps/web/src/components/global/forms/field-panel.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Tooltip, TooltipExplanation } from '~/components/global/tooltip'
import type { BaseType } from '~/components/workflow/types/unified-types'
import { VarTypeIcon } from '~/components/workflow/utils/icon-helper'
import { safeLocalStorage } from '~/lib/safe-localstorage'
import { ValidationErrorBadge } from './validation-error-badge'

/** Default label column width in px — matches the previous hardcoded `w-40` (10rem). */
const DEFAULT_LABEL_WIDTH = 160
const MIN_LABEL_WIDTH = 96
/** Max label width as a fraction of the panel width, so content never collapses. */
const MAX_LABEL_FRACTION = 0.7

const RESIZE_EVENT = 'auxx:field-panel-resize'
const storageKey = (resizeId: string) => `auxx:field-panel:label-w:${resizeId}`

interface FieldPanelResizeDetail {
  resizeId: string
  width: number
  /** false while dragging (DOM-only updates), true on release/reset (state + storage) */
  commit: boolean
  /** Emitting panel element, so it can ignore its own events */
  source: HTMLElement | null
}

const dispatchResize = (detail: FieldPanelResizeDetail) => {
  window.dispatchEvent(new CustomEvent<FieldPanelResizeDetail>(RESIZE_EVENT, { detail }))
}

/**
 * Variants for FieldPanel orientation
 * Controls how FieldPanelRow children lay out their label and content.
 * The label column width comes from --field-panel-label-w, set inline on the panel root.
 */
const fieldPanelVariants = cva(
  [
    'relative grow rounded-2xl px-1.5 py-0.5',
    'bg-primary-200/30 dark:bg-[#23272e]/30 border flex flex-col focus-within:border-primary-300',
  ],
  {
    variants: {
      /**
       * Which rule strips the bottom border from the panel's last row.
       *
       * `auto` is a DIRECT-CHILD selector, so it breaks the moment rows are
       * nested (field groups wrap their members in a section div): the last row
       * inside a group keeps a border it should not have, and a direct-child row
       * followed by a group wrapper loses one it should keep. CSS cannot express
       * "no field-row later in document order" across different parents, so
       * `managed` has the renderer mark the last row with `data-last-row`
       * instead — the honest encoding, not a shortcut.
       */
      rowBorders: {
        auto: ['[&>[data-slot=field-row]:not(:has(~[data-slot=field-row]))]:border-b-0'],
        managed: ['[&_[data-slot=field-row][data-last-row]]:border-b-0'],
      },
      orientation: {
        horizontal: [
          // field-row: horizontal layout (default behavior)
          '[&_[data-slot=field-row]]:flex-row [&_[data-slot=field-row]]:items-start',
          // field-row-label: fixed width and height
          '[&_[data-slot=field-row-label]]:w-(--field-panel-label-w) [&_[data-slot=field-row-label]]:shrink-0 [&_[data-slot=field-row-label]]:min-h-8',
          // gutter between the label/content boundary (where the resize line sits) and the content
          '[&_[data-slot=field-row-content]]:ps-2',
        ],
        vertical: [
          // field-row: vertical layout (stacked)
          '[&_[data-slot=field-row]]:flex-col [&_[data-slot=field-row]]:items-stretch',
          // field-row-label: full width
          '[&_[data-slot=field-row-label]]:w-full [&_[data-slot=field-row-label]]:shrink [&_[data-slot=field-row-label]]:pt-1.5 [&_[data-slot=field-row-label]]:pb-1 [&_[data-slot=field-row-content]]:ps-2',
          '[&_[data-slot=field-row]]:pb-1',
        ],
        responsive: [
          '@container',
          // Base (mobile): vertical layout
          '[&_[data-slot=field-row]]:flex-col [&_[data-slot=field-row]]:items-stretch',
          '[&_[data-slot=field-row-label]]:w-full [&_[data-slot=field-row-label]]:shrink [&_[data-slot=field-row-label]]:pt-1.5 [&_[data-slot=field-row-label]]:pb-1 [&_[data-slot=field-row-content]]:ps-2',
          '[&_[data-slot=field-row]]:pb-1',
        ],
      },
      /** Container width at which a responsive panel flips to horizontal (sm=24rem, md=28rem) */
      breakpoint: {
        sm: [],
        md: [],
      },
    },
    compoundVariants: [
      // Horizontal layout above the container breakpoint
      // (field-row-content keeps its ps-2 as the boundary gutter)
      {
        orientation: 'responsive',
        breakpoint: 'sm',
        className: [
          '@sm:[&_[data-slot=field-row]]:flex-row @sm:[&_[data-slot=field-row]]:items-start',
          '@sm:[&_[data-slot=field-row-label]]:w-(--field-panel-label-w) @sm:[&_[data-slot=field-row-label]]:shrink-0 @sm:[&_[data-slot=field-row-label]]:min-h-8',
          '@sm:[&_[data-slot=field-row-label]]:pt-0 @sm:[&_[data-slot=field-row-label]]:pb-0',
          '@sm:[&_[data-slot=field-row]]:pb-0',
        ],
      },
      {
        orientation: 'responsive',
        breakpoint: 'md',
        className: [
          '@md:[&_[data-slot=field-row]]:flex-row @md:[&_[data-slot=field-row]]:items-start',
          '@md:[&_[data-slot=field-row-label]]:w-(--field-panel-label-w) @md:[&_[data-slot=field-row-label]]:shrink-0 @md:[&_[data-slot=field-row-label]]:min-h-8',
          '@md:[&_[data-slot=field-row-label]]:pt-0 @md:[&_[data-slot=field-row-label]]:pb-0',
          '@md:[&_[data-slot=field-row]]:pb-0',
        ],
      },
    ],
    defaultVariants: {
      orientation: 'responsive',
      breakpoint: 'sm',
      rowBorders: 'auto',
    },
  }
)

/**
 * Bordered, rounded panel that groups labeled form rows (FieldPanelRow).
 * Formerly VarEditorField — generic form-layout primitive, not workflow-specific.
 */
interface FieldPanelProps extends VariantProps<typeof fieldPanelVariants> {
  children: React.ReactNode
  validationError?: string
  validationType?: 'error' | 'warning'
  className?: string
  /**
   * Opt-in drag-resizing of the label column (horizontal / responsive-at-@sm only).
   * The width persists in localStorage under this id; mounted panels sharing the
   * same id resize together in real time. Double-click the divider to reset.
   */
  resizeId?: string
  /** Label column width in px. Also the reset target when resizing. Default 160 (the old w-40). */
  defaultLabelWidth?: number
}

function FieldPanel({
  children,
  validationError,
  validationType = 'error',
  orientation = 'responsive',
  breakpoint = 'sm',
  rowBorders = 'auto',
  className,
  resizeId,
  defaultLabelWidth = DEFAULT_LABEL_WIDTH,
}: FieldPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ startX: number; startWidth: number; maxWidth: number } | null>(null)
  const [labelWidth, setLabelWidth] = useState(defaultLabelWidth)
  const [isResizing, setIsResizing] = useState(false)
  // The label column starts after the panel's left padding, which callers can
  // override via className (e.g. p-0) — measure it instead of assuming px-1.5
  const [padLeft, setPadLeft] = useState('0.375rem')

  // Hydrate the stored width before paint (avoids a visible width jump)
  useLayoutEffect(() => {
    if (!resizeId) return
    const stored = Number(safeLocalStorage.get(storageKey(resizeId)))
    if (Number.isFinite(stored) && stored >= MIN_LABEL_WIDTH) setLabelWidth(stored)
    if (panelRef.current) setPadLeft(getComputedStyle(panelRef.current).paddingLeft)
  }, [resizeId])

  // Follow resizes from other mounted panels sharing this resizeId
  useEffect(() => {
    if (!resizeId) return
    const onResize = (e: Event) => {
      const detail = (e as CustomEvent<FieldPanelResizeDetail>).detail
      if (detail.resizeId !== resizeId || detail.source === panelRef.current) return
      if (detail.commit) {
        setLabelWidth(detail.width)
      } else {
        // Mid-drag: mutate the CSS var directly, no re-render
        panelRef.current?.style.setProperty('--field-panel-label-w', `${detail.width}px`)
      }
    }
    window.addEventListener(RESIZE_EVENT, onResize)
    return () => window.removeEventListener(RESIZE_EVENT, onResize)
  }, [resizeId])

  const widthFromDrag = (clientX: number) => {
    const drag = dragState.current!
    return Math.min(
      drag.maxWidth,
      Math.max(MIN_LABEL_WIDTH, drag.startWidth + clientX - drag.startX)
    )
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const panelWidth = panelRef.current?.offsetWidth ?? 0
    dragState.current = {
      startX: e.clientX,
      startWidth: labelWidth,
      maxWidth: Math.max(MIN_LABEL_WIDTH, panelWidth * MAX_LABEL_FRACTION),
    }
    setIsResizing(true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return
    const width = widthFromDrag(e.clientX)
    panelRef.current?.style.setProperty('--field-panel-label-w', `${width}px`)
    dispatchResize({ resizeId: resizeId!, width, commit: false, source: panelRef.current })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return
    const width = widthFromDrag(e.clientX)
    dragState.current = null
    setIsResizing(false)
    setLabelWidth(width)
    safeLocalStorage.set(storageKey(resizeId!), String(width))
    dispatchResize({ resizeId: resizeId!, width, commit: true, source: panelRef.current })
  }

  const handleDoubleClick = () => {
    setLabelWidth(defaultLabelWidth)
    safeLocalStorage.remove(storageKey(resizeId!))
    dispatchResize({
      resizeId: resizeId!,
      width: defaultLabelWidth,
      commit: true,
      source: panelRef.current,
    })
  }

  const showResizer = !!resizeId && orientation !== 'vertical'

  return (
    <div
      ref={panelRef}
      data-slot='field'
      data-orientation={orientation}
      style={{ '--field-panel-label-w': `${labelWidth}px` } as React.CSSProperties}
      className={cn(fieldPanelVariants({ orientation, breakpoint, rowBorders }), className)}>
      {children}
      {showResizer && (
        <div
          aria-hidden
          className={cn(
            // Only rendered for fine pointers (mouse/trackpad) — no drag affordance on touch devices
            'group/resizer absolute inset-y-0 z-10 hidden w-2.5 -translate-x-1/2 cursor-col-resize touch-none',
            // In responsive mode the handle also requires the container to lay out horizontally
            orientation !== 'responsive'
              ? 'pointer-fine:block'
              : breakpoint === 'md'
                ? 'pointer-fine:@md:block'
                : 'pointer-fine:@sm:block'
          )}
          style={{ left: `calc(var(--field-panel-label-w) + ${padLeft})` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}>
          <div
            className={cn(
              'mx-auto h-full w-px bg-primary-200 opacity-0 transition-opacity group-hover/resizer:opacity-100',
              isResizing && 'opacity-100 bg-info'
            )}
          />
        </div>
      )}
      <ValidationErrorBadge error={validationError} type={validationType} />
    </div>
  )
}

interface FieldPanelRowProps {
  children: React.ReactNode
  title: string
  description?: string
  isRequired?: boolean
  validationError?: string
  validationType?: 'error' | 'warning'
  type?: BaseType
  showIcon?: boolean
  icon?: React.ReactNode
  className?: string
  /** When provided, renders a clear button on row hover (positioned on the right edge) */
  onClear?: () => void
  /**
   * Marks this row as the panel's last one for `rowBorders: 'managed'`. Only
   * needed when rows are nested (field groups), where the default direct-child
   * rule cannot see them.
   */
  isLastRow?: boolean
}

/**
 * Labeled row inside a FieldPanel: label (with optional icon/description) + content.
 * Formerly VarEditorFieldRow.
 */
function FieldPanelRow({
  children,
  title,
  description,
  isRequired = false,
  validationError,
  validationType = 'error',
  type,
  icon,
  showIcon = false,
  className,
  onClear,
  isLastRow = false,
}: FieldPanelRowProps) {
  return (
    <div
      data-slot='field-row'
      data-last-row={isLastRow ? '' : undefined}
      className={cn(
        'group/field-row relative flex border-b dark:border-b-[#404754]/20',
        className
      )}>
      <div
        data-slot='field-row-label'
        className='flex flex-row gap-1 ps-2 items-center [&_svg]:size-4'>
        {showIcon && (icon ? icon : <VarTypeIcon type={type!} />)}
        <div className='text-sm'>
          <span className='text-primary-600'>{title}</span>
          {isRequired && <span className='text-red-500'>*</span>}
        </div>
        {description && <TooltipExplanation text={description} />}
      </div>
      <div data-slot='field-row-content' className='w-full flex-1 relative'>
        {children}
      </div>
      {onClear && (
        <div className='absolute -right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/field-row:opacity-100 transition-opacity z-10'>
          <Tooltip content='Clear content'>
            <Button
              variant='ghost'
              size='icon-xs'
              className='size-4 bg-primary-500/30 text-primary-100 transition-colors hover:bg-bad-100 hover:text-bad-500'
              onClick={onClear}>
              <X className='size-3!' />
            </Button>
          </Tooltip>
        </div>
      )}
      <ValidationErrorBadge error={validationError} type={validationType} />
    </div>
  )
}

export { FieldPanel, FieldPanelRow }
