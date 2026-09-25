// apps/web/src/components/global/report-grid/report-grid.tsx

'use client'

import { Alert } from '@auxx/ui/components/alert'
import { ColumnResizeHandle } from '@auxx/ui/components/column-resize-handle'
import { InputSearch } from '@auxx/ui/components/input-search'
import { PinnedEdgeShadow } from '@auxx/ui/components/pinned-edge-shadow'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TooltipExplanation } from '@auxx/ui/components/tooltip'
import { ICON_CENTER_REM, INDENT_REM } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, ChevronRight, Search, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type React from 'react'
import {
  type CSSProperties,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  formatStatementCell,
  GRID_ROW_KIND_CLASS,
  hasAnyDrillKey,
  maxAccountCodeLength,
  type StatementColumn,
  StatementRowIcon,
  StatementRowLabel,
  type StatementVerdict,
  StatementVerdictMark,
  showsValues,
  VALUE_COL,
  verdictRowId,
  verdictText,
} from '~/components/accounting/ui/reports/statement-parts'
import {
  layoutReportRows,
  type ReportGridItem,
  type ReportGridRow,
  visibleRange,
} from './report-grid-layout'
import { useReportLabelWidth } from './use-report-label-width'

/** A text column between the label and the amounts (the general ledger's type, name, memo, split). */
export interface ReportTextColumn {
  key: string
  label: string
  /** Fixed width in px. Omit for the one column that takes the remaining width. */
  width?: number
  /** For the flexible column: the width it never shrinks below. */
  minWidth?: number
  /** `right` for figures, so the header sits over them. */
  align?: 'left' | 'right'
}

export interface ReportGridProps {
  /** Names the saved label width in localStorage. */
  reportKey: string
  columns: StatementColumn[]
  textColumns?: ReportTextColumn[]
  rows: ReportGridRow[]
  currency: string
  onRowClick?: (row: ReportGridRow) => void
  /** Which rows `onRowClick` acts on. Derive it from the same condition the handler branches on. */
  canRowDrill?: (row: ReportGridRow) => boolean
  /** The row whose drawer is open, highlighted as the review queue does. */
  isRowActive?: (row: ReportGridRow) => boolean
  verdict?: StatementVerdict
  /** Turns the label header into a search field. Filtering is the caller's. */
  search?: { value: string; onChange: (value: string) => void }
  /** Open every section, e.g. while searching. */
  openAll?: boolean
  /** Sections open on mount. */
  defaultOpenIds?: readonly string[]
  labelHeading?: string
  defaultLabelWidth?: number
  /** Rows now in (or near) the viewport, for a caller that loads rows lazily. */
  onVisibleRowsChange?: (rows: ReportGridRow[]) => void
  /** Below the frame: a search count, a note. */
  footer?: ReactNode
}

/** `max-w-5xl` less the page's `p-4`: the width every report had before 108. */
const NARROW_MAX_WIDTH = 992
const MONEY_WIDTH = 128
/** Frame border, body `p-1` and the row's `px-1`, both sides. */
const CHROME_WIDTH = 18
const OVERSCAN = 320
const NO_TEXT_COLUMNS: ReportTextColumn[] = []
const SPRING = { type: 'spring', stiffness: 300, damping: 30 } as const
/** How long after a toggle rows animate in and out rather than appear. */
const ANIMATION_MS = 500

/**
 * The report table (plans/accounting/tasks/108-reports-that-scale.md §3.1): the
 * open part of a statement as one flat, virtualized list whose rows look like
 * `StatementTable`'s. The label column is pinned and resizable; the page widens
 * to full width when the columns need it.
 */
export function ReportGrid({
  reportKey,
  columns,
  textColumns = NO_TEXT_COLUMNS,
  rows,
  currency,
  onRowClick,
  canRowDrill = hasAnyDrillKey,
  isRowActive,
  verdict,
  search,
  openAll = false,
  defaultOpenIds,
  labelHeading = 'Account',
  defaultLabelWidth = 320,
  onVisibleRowsChange,
  footer,
}: ReportGridProps) {
  const [labelWidth, setLabelWidth] = useReportLabelWidth(reportKey, defaultLabelWidth)
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(defaultOpenIds))
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const animation = useRef({ until: 0, previous: new Map<string, number>() })

  const layout = useMemo(
    () => layoutReportRows(rows, (row) => openAll || openIds.has(row.id)),
    [rows, openIds, openAll]
  )
  const codeWidthCh = useMemo(() => maxAccountCodeLength(rows), [rows])
  const markedRowId = verdict ? verdictRowId(rows) : undefined

  const flexColumn = textColumns.find((column) => column.width === undefined)
  const minWidth =
    labelWidth +
    textColumns.reduce((sum, column) => sum + (column.width ?? column.minWidth ?? 160), 0) +
    columns.length * MONEY_WIDTH +
    CHROME_WIDTH
  const wide = minWidth > NARROW_MAX_WIDTH

  // Scroll and size, in state so the visible window follows them.
  const [scroll, setScroll] = useState({ top: 0, height: 0 })
  const [headerHeight, setHeaderHeight] = useState(33)
  const [available, setAvailable] = useState(0)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let frame = 0
    const read = () => {
      frame = 0
      setScroll((prev) =>
        prev.top === viewport.scrollTop && prev.height === viewport.clientHeight
          ? prev
          : { top: viewport.scrollTop, height: viewport.clientHeight }
      )
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    viewport.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(onScroll)
    observer.observe(viewport)
    return () => {
      viewport.removeEventListener('scroll', onScroll)
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  const hasFooter = !!footer || (!!verdict && !markedRowId)

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-observe when the footer mounts or unmounts
  useLayoutEffect(() => {
    const root = rootRef.current
    const header = headerRef.current
    if (!root || !header) return
    const measure = () => {
      setHeaderHeight(header.offsetHeight)
      const footerHeight = footerRef.current ? footerRef.current.offsetHeight + 12 : 0
      setAvailable(root.clientHeight - footerHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    observer.observe(header)
    if (footerRef.current) observer.observe(footerRef.current)
    return () => observer.disconnect()
  }, [hasFooter])

  // Body `p-1` top and bottom, plus the frame's 1px borders.
  const naturalHeight = headerHeight + layout.total + 8 + 2
  const frameHeight = available > 0 ? Math.min(available, naturalHeight) : naturalHeight

  const bodyTop = scroll.top - headerHeight - 4
  const [start, end] = visibleRange(
    layout.items,
    bodyTop - OVERSCAN,
    bodyTop + scroll.height + OVERSCAN
  )
  const visible = layout.items.slice(start, end)

  useEffect(() => {
    onVisibleRowsChange?.(layout.items.slice(start, end).map((item) => item.row))
  }, [layout, start, end, onVisibleRowsChange])

  const toggleOpen = useCallback(
    (rowId: string) => {
      animation.current = {
        until: performance.now() + ANIMATION_MS,
        previous: layout.offsetById,
      }
      setOpenIds((prev) => {
        const next = new Set(prev)
        if (next.has(rowId)) next.delete(rowId)
        else next.add(rowId)
        return next
      })
    },
    [layout.offsetById]
  )

  const animating = performance.now() < animation.current.until
  const presence = useMemo(
    () => ({ animating, offsetById: layout.offsetById }),
    [animating, layout.offsetById]
  )

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const target = event.currentTarget
      target.setPointerCapture(event.pointerId)
      const startX = event.clientX
      const startWidth = labelWidth
      let width = startWidth
      const move = (moveEvent: PointerEvent) => {
        width = Math.round(Math.min(900, Math.max(160, startWidth + moveEvent.clientX - startX)))
        contentRef.current?.style.setProperty('--rg-label-w', `${width}px`)
      }
      const up = () => {
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', up)
        target.removeEventListener('pointercancel', up)
        setLabelWidth(width)
      }
      target.addEventListener('pointermove', move)
      target.addEventListener('pointerup', up)
      target.addEventListener('pointercancel', up)
    },
    [labelWidth, setLabelWidth]
  )

  // With a flexible text column the label keeps its width; otherwise it takes the rest.
  const labelGrows = !flexColumn
  const labelStyle = useMemo<CSSProperties>(
    () => ({ flex: labelGrows ? '1 0 var(--rg-label-w)' : '0 0 var(--rg-label-w)' }),
    [labelGrows]
  )

  // Rows are memoised; the page's click handler is usually an inline arrow.
  const onRowClickRef = useRef(onRowClick)
  onRowClickRef.current = onRowClick
  const handleRowClick = useCallback((row: ReportGridRow) => onRowClickRef.current?.(row), [])

  return (
    <div
      ref={rootRef}
      className='mx-auto flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3'
      style={{ maxWidth: wide ? undefined : NARROW_MAX_WIDTH }}>
      <div
        className='flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-primary-200/50 dark:border-[#1e2227]'
        style={{ height: frameHeight }}>
        <ScrollArea
          orientation='both'
          viewportRef={viewportRef}
          className='h-full min-h-0'
          // Thin and flush, so the tracks stay clear of the last column's figures.
          scrollbarClassName='z-40 data-[orientation=vertical]:mr-0 data-[orientation=vertical]:w-1 data-[orientation=horizontal]:mb-0 data-[orientation=horizontal]:h-1'
          noFade>
          <div
            ref={contentRef}
            className='relative'
            style={{ minWidth, '--rg-label-w': `${labelWidth}px` } as CSSProperties}>
            <div
              ref={headerRef}
              className='sticky top-0 z-20 flex items-center border-primary-200/50 border-b bg-primary-50 px-1 py-1.5 text-muted-foreground text-sm dark:border-[#1e2227] dark:bg-background'>
              <div
                className='sticky left-0 z-10 flex min-w-0 items-center self-stretch bg-primary-50 dark:bg-background'
                style={labelStyle}>
                <span className='size-7 shrink-0' />
                {search ? (
                  <InputSearch
                    value={search.value}
                    onChange={(event) => search.onChange(event.target.value)}
                    placeholder={labelHeading}
                    className='h-7 border-none bg-transparent shadow-none ring-0 hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-1'
                  />
                ) : (
                  <span className='truncate px-1'>{labelHeading}</span>
                )}
                <ColumnResizeHandle onPointerDown={startResize} />
              </div>
              {textColumns.map((column) => (
                <div
                  key={column.key}
                  className={cn('min-w-0 truncate px-1', column.align === 'right' && 'text-right')}
                  style={textColumnStyle(column)}>
                  {column.label}
                </div>
              ))}
              <div className='flex shrink-0 items-center'>
                {columns.map((column) => (
                  <div key={column.key} className={cn(VALUE_COL, 'text-right')}>
                    {column.label}
                  </div>
                ))}
              </div>
            </div>

            <div className='relative' style={{ height: layout.total + 8 }}>
              {wide && (
                <PinnedEdgeShadow
                  scrollRef={viewportRef}
                  left='var(--rg-label-w)'
                  height={layout.total + 8}
                  headerOffset={headerHeight}
                  className='z-30'
                />
              )}
              {layout.items.length === 0 ? (
                <div className='p-1'>
                  <EmptySection
                    icon={<Search className='size-5' />}
                    title={search?.value ? 'No matches' : 'Nothing to show'}
                  />
                </div>
              ) : (
                <AnimatePresence initial={false} custom={presence}>
                  {visible.map((item) => (
                    <ReportGridRowView
                      key={item.row.id}
                      item={item}
                      enterFrom={
                        animating
                          ? (animation.current.previous.get(item.row.id) ?? null)
                          : undefined
                      }
                      columns={columns}
                      textColumns={textColumns}
                      labelStyle={labelStyle}
                      currency={currency}
                      codeWidthCh={codeWidthCh}
                      drillable={!!onRowClick && canRowDrill(item.row)}
                      active={!!isRowActive?.(item.row)}
                      onRowClick={handleRowClick}
                      onToggleOpen={toggleOpen}
                      verdict={item.row.id === markedRowId ? verdict : undefined}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>

      {hasFooter && (
        <div ref={footerRef} className='flex shrink-0 flex-col gap-3'>
          {footer}
          {verdict && !markedRowId && (
            <Alert variant={verdict.ok ? 'success' : 'destructive'}>
              {verdict.ok ? <CheckCircle2 /> : <TriangleAlert />}
              <span>{verdictText(verdict)}</span>
            </Alert>
          )}
        </div>
      )}
    </div>
  )
}

function textColumnStyle(column: ReportTextColumn): CSSProperties {
  return column.width === undefined
    ? { flex: `1 1 ${column.minWidth ?? 160}px`, minWidth: column.minWidth ?? 160 }
    : { flex: `0 0 ${column.width}px` }
}

interface PresenceState {
  animating: boolean
  offsetById: Map<string, number>
}

interface ReportGridRowViewProps {
  item: ReportGridItem
  /**
   * `undefined` when the row mounts from scrolling (no entrance); the offset it
   * had before a toggle, to slide from; or `null` for a row the toggle revealed.
   */
  enterFrom: number | null | undefined
  columns: StatementColumn[]
  textColumns: ReportTextColumn[]
  labelStyle: CSSProperties
  currency: string
  codeWidthCh: number
  drillable: boolean
  active: boolean
  onRowClick?: (row: ReportGridRow) => void
  onToggleOpen: (rowId: string) => void
  verdict?: StatementVerdict
}

/**
 * One positioned row. The label half is sticky and painted over the page's own
 * background (`bg-neutral-100` under the panel's `bg-muted/50`), so when pinned
 * it hides the cells scrolling beneath it and reads identically when it is not.
 */
const ReportGridRowView = memo(function ReportGridRowView({
  item,
  enterFrom,
  columns,
  textColumns,
  labelStyle,
  currency,
  codeWidthCh,
  drillable,
  active,
  onRowClick,
  onToggleOpen,
  verdict,
}: ReportGridRowViewProps) {
  const { row, depth, hasChildren, isOpen, offset, height, top, lineHeight } = item
  // The review queue's open-row look (`review-queue-page.tsx`), on both halves.
  const kindClass = cn(GRID_ROW_KIND_CLASS[row.kind], active && 'bg-primary-100')
  const showValues = showsValues(row, hasChildren, isOpen)
  const toggle = hasChildren ? () => onToggleOpen(row.id) : undefined
  const rowClick = drillable ? () => onRowClick?.(row) : toggle
  const indentRem = depth * INDENT_REM

  const variants = useMemo(
    () => ({
      exit: (presence: PresenceState) => {
        if (!presence.animating) return { opacity: 0, transition: { duration: 0 } }
        const next = presence.offsetById.get(row.id)
        // Still in the list, pushed out of view: slide there. Hidden by a collapse: fade out.
        return next !== undefined
          ? { y: next, transition: SPRING }
          : { opacity: 0, filter: 'blur(3px)', transition: SPRING }
      },
    }),
    [row.id]
  )

  const initial =
    enterFrom === undefined
      ? false
      : enterFrom === null
        ? { y: offset - 6, opacity: 0, filter: 'blur(3px)' }
        : { y: enterFrom }

  return (
    <motion.div
      // Raised while active, so the next row does not paint over the ring's bottom edge.
      className={cn('group/rg-row absolute top-0 right-1 left-1', active && 'z-10')}
      style={{ height }}
      initial={initial}
      animate={{ y: offset, opacity: 1, filter: 'blur(0px)' }}
      exit='exit'
      variants={variants}
      transition={SPRING}>
      <div
        className={cn(
          'relative flex text-muted-foreground text-sm',
          rowClick ? 'cursor-pointer' : 'cursor-default'
        )}
        style={{ marginTop: top, height: lineHeight }}
        onClick={rowClick}>
        {active && (
          <div
            className='pointer-events-none absolute inset-y-0 right-0 z-20 rounded-md ring-1 ring-primary-200'
            style={{ left: `${indentRem}rem` }}
          />
        )}
        <div
          className='sticky left-0 z-10 flex min-w-0 bg-neutral-100 dark:bg-background'
          style={labelStyle}>
          <div className='pointer-events-none absolute inset-0 bg-muted/50' />
          {Array.from({ length: depth }, (_, level) => (
            <div
              key={level}
              className='pointer-events-none absolute z-10 w-px bg-border'
              style={{
                left: `${level * INDENT_REM + ICON_CENTER_REM}rem`,
                top: -top,
                height: height,
              }}
            />
          ))}
          <div className='relative flex min-w-0 flex-1' style={{ paddingLeft: `${indentRem}rem` }}>
            <div className={cn('flex min-w-0 flex-1 items-center rounded-l-md pl-1', kindClass)}>
              <span className='relative flex size-7 shrink-0 items-center justify-center px-1 text-muted-foreground'>
                <StatementRowIcon row={row} hasChildren={hasChildren} />
              </span>
              {row.loading ? (
                <Skeleton className='mx-1 h-4 w-40 max-w-full' />
              ) : (
                <span className='truncate px-1 py-1.5 text-foreground text-sm'>
                  <StatementRowLabel
                    row={row}
                    codeWidthCh={codeWidthCh}
                    verdictMark={verdict ? <StatementVerdictMark verdict={verdict} /> : undefined}
                  />
                </span>
              )}
              {row.meta?.note && (
                <TooltipExplanation text={row.meta.note} className='shrink-0 text-primary-400' />
              )}
              {row.meta?.badge && (
                <span className='ml-1 shrink-0 whitespace-nowrap text-primary-400 text-sm'>
                  {row.meta.badge}
                </span>
              )}
              {hasChildren && (
                <button
                  type='button'
                  onClick={(event) => {
                    event.stopPropagation()
                    toggle?.()
                  }}
                  className='shrink-0 rounded-md p-1 hover:bg-primary/5'
                  aria-label={isOpen ? 'Collapse' : 'Expand'}>
                  <ChevronRight
                    className={cn(
                      'size-3.5 text-muted-foreground transition-transform',
                      isOpen && 'rotate-90'
                    )}
                  />
                </button>
              )}
            </div>
          </div>
        </div>
        <div
          className={cn(
            'flex min-w-0 items-center rounded-r-md pr-1',
            textColumns.some((column) => column.width === undefined) ? 'flex-1' : 'shrink-0',
            kindClass
          )}>
          {textColumns.map((column) => {
            const value = row.cells?.[column.key]
            return (
              <div
                key={column.key}
                className={cn(
                  'min-w-0 truncate px-1 text-sm',
                  column.align === 'right' && 'text-right'
                )}
                style={textColumnStyle(column)}
                title={typeof value === 'string' ? value : undefined}>
                {value}
              </div>
            )
          })}
          <div className='flex shrink-0 items-center'>
            {columns.map((column, index) => (
              <div
                key={column.key}
                className={cn(VALUE_COL, 'text-right font-mono text-sm tabular-nums')}>
                {showValues && !row.loading
                  ? formatStatementCell(row.values[index], column, currency)
                  : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
})
