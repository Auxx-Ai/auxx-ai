// apps/web/src/components/editor/kb-article/table-node-view.tsx
'use client'

import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, useReactNodeView } from '@tiptap/react'
import { GripHorizontal, GripVertical, PanelTop, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import blockStyles from './block-node-view.module.css'
import styles from './container-node-view.module.css'
import {
  endTableDrag,
  getTableDrag,
  getTableDrop,
  startTableDrag,
  subscribeTableDrag,
} from './table-drag-state'
import {
  addColumnAt,
  addRowAt,
  getColumnCount,
  getRowCount,
  isFirstRowHeader,
  removeColumnAt,
  removeRowAt,
  toggleHeaderRow,
} from './table-helpers'

interface RowRect {
  top: number
  height: number
}

interface ColRect {
  left: number
  width: number
}

/**
 * React NodeView for the `table` block. Replaces the imperative `TableView`
 * with a single React tree that owns the column strip, row gutter, +/X
 * chrome, and the `<table>` element. The Tiptap content DOM (configured as
 * `<tbody>` in `extensions/table/table.ts` via `contentDOMElementTag`) is
 * attached as a child of our `<table>` via `nodeViewContentRef` — avoids
 * the `<NodeViewContent>` wrapper that would otherwise double-wrap the
 * tbody and produce invalid HTML. Row + column reorder runs through
 * `table-drag-state.ts` (module-level singleton with document capture-phase
 * listeners — same pattern as panel-drag-state).
 */
export function TableNodeView({ node, editor, getPos }: NodeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const tableEl = useRef<HTMLTableElement>(null)
  const { nodeViewContentRef } = useReactNodeView()
  const [, forceTick] = useState(0)

  // Attach PM's `<tbody>` content DOM element inside our `<table>`. This is
  // what `<NodeViewContent>` would do internally, but we want zero wrapper
  // elements so the table tree is `<table><tbody><tr>...</tr></tbody></table>`.
  const setTableRef = useCallback(
    (el: HTMLTableElement | null) => {
      tableEl.current = el
      if (typeof nodeViewContentRef === 'function') nodeViewContentRef(el)
    },
    [nodeViewContentRef]
  )
  const [rowRects, setRowRects] = useState<RowRect[]>([])
  const [colRects, setColRects] = useState<ColRect[]>([])
  const [tableWidth, setTableWidth] = useState<number>(0)
  const [tableHeight, setTableHeight] = useState<number>(0)
  // Hover tracking — `null` means nothing is hovered. Driven by a delegated
  // mousemove listener on the body card; reveals the matching row/col's
  // drag handle + delete button. Without this, the user would have to
  // hover the narrow gutter strip itself to reveal the chrome.
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [hoveredCol, setHoveredCol] = useState<number | null>(null)

  // Re-render on table-drag state changes (drop indicators, source opacity).
  useEffect(() => subscribeTableDrag(() => forceTick((t) => t + 1)), [])

  const resolveTablePos = useCallback((): number | null => {
    if (typeof getPos !== 'function') return null
    const p = getPos()
    return typeof p === 'number' ? p : null
  }, [getPos])

  // `getPos()` can throw mid-update when the node has just been unmounted
  // from the doc (PM hasn't yet called destroy on this NodeView). Treat any
  // throw as "no position yet" and render with empty data; the next render
  // pass will have valid state.
  let containerPosForRender: number | null = null
  if (typeof getPos === 'function') {
    try {
      const p = getPos()
      if (typeof p === 'number') containerPosForRender = p
    } catch {
      containerPosForRender = null
    }
  }
  const lineNumber =
    containerPosForRender != null
      ? (() => {
          try {
            return editor.state.doc.resolve(containerPosForRender).index(0) + 1
          } catch {
            return null
          }
        })()
      : null

  const tablePosNow = containerPosForRender ?? 0
  const rowCount = containerPosForRender != null ? getRowCount(editor, tablePosNow) : 0
  const colCount = containerPosForRender != null ? getColumnCount(editor, tablePosNow) : 0
  const hasHeaderRow = containerPosForRender != null ? isFirstRowHeader(editor, tablePosNow) : false

  // Measure row / column rects for handle positioning. We do NOT tag the
  // tbody/tr/cell DOM with data-row-index / data-col-index — PM's
  // tableCell.renderHTML / tableHeader.renderHTML re-render cells without
  // preserving externally-set data attrs, so any attributes set here are
  // gone after the next doc mutation. Drag-state collision detection,
  // hover tracking, and drag-preview clones all use sibling-index lookup
  // off of `<tbody> > <tr>` and `<tr> > <th|td>` instead.
  const measure = useCallback(() => {
    const table = tableEl.current
    const wrapper = wrapperRef.current
    if (!table || !wrapper) return
    const tbody = table.querySelector(':scope > tbody')
    if (!tbody) return

    const rows = Array.from(tbody.querySelectorAll(':scope > tr'))

    // Anchor measurements to the table itself so the column strip and row
    // gutter stay aligned even when the body card has padding / borders.
    const tableRect = table.getBoundingClientRect()
    const wrapperRect = wrapper.getBoundingClientRect()
    const offsetX = tableRect.left - wrapperRect.left
    const offsetY = tableRect.top - wrapperRect.top

    const newRowRects: RowRect[] = rows.map((tr) => {
      const r = tr.getBoundingClientRect()
      return { top: r.top - tableRect.top + offsetY, height: r.height }
    })
    setRowRects((prev) => (rectsEqual(prev, newRowRects, 'top', 'height') ? prev : newRowRects))

    const firstRow = rows[0]
    if (firstRow) {
      const cells = Array.from(firstRow.querySelectorAll(':scope > th, :scope > td'))
      const newColRects: ColRect[] = cells.map((cell) => {
        const r = cell.getBoundingClientRect()
        return { left: r.left - tableRect.left + offsetX, width: r.width }
      })
      setColRects((prev) => (rectsEqual(prev, newColRects, 'left', 'width') ? prev : newColRects))
    }
    setTableWidth(table.offsetWidth)
    setTableHeight(table.offsetHeight)
  }, [])

  // Re-runs when `node` changes. Deferred to the next frame so PM has
  // finished its contentDOM sync (cell adds/removes can land after our
  // React commit). Without the rAF, measuring after a column insert reads
  // stale DOM and the column chrome stays at its old positions until the
  // next event that does happen to remeasure (e.g. adding a row).
  useEffect(() => {
    const id = requestAnimationFrame(() => measure())
    return () => cancelAnimationFrame(id)
  }, [node, measure])

  // Re-measure on layout changes. Observing the table itself catches the
  // initial mount case where Tiptap appends the `<tbody>` asynchronously
  // after our first paint — without this, `tableWidth` stays at 0 until
  // the next `node` mutation, and the insert-lines / delete-strip are
  // width-0 ghosts.
  useEffect(() => {
    const table = tableEl.current
    if (!table) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(table)
    return () => ro.disconnect()
  }, [measure])

  // Delegated hover tracking on the body card. Resolves the hovered row +
  // column from any descendant — cells, gutter strips (which carry their
  // own data-row-index / data-col-index), or insert lines. Without this,
  // the trash + drag handle would only reveal when the user hovers the
  // narrow gutter strip itself.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const onMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      // Preserve the previous hover when the cursor passes over an insert
      // line (which has `pointer-events: auto` but no row/col index) so
      // the chrome doesn't flicker as the mouse crosses row/column borders.
      const onInsertLine = !!target.closest(`.${styles.rowInsertLine}, .${styles.colInsertLine}`)

      // Resolve row: chrome wrappers (.rowHandleRow / .rowDeleteRow) carry
      // data-row-index. For cells, walk up to <tr> and use sibling index —
      // PM's `tableCell.renderHTML` re-renders cells without preserving
      // externally-set data attrs, so attributes survive on our chrome
      // wrappers but not on the real tbody/tr/cell DOM.
      let rowIdx: number | null = null
      const rowAttrEl = target.closest('[data-row-index]') as HTMLElement | null
      if (rowAttrEl) {
        const n = Number(rowAttrEl.dataset.rowIndex)
        if (Number.isFinite(n)) rowIdx = n
      } else {
        const trEl = target.closest('tr') as HTMLElement | null
        if (trEl?.parentElement?.tagName === 'TBODY') {
          rowIdx = Array.prototype.indexOf.call(trEl.parentElement.children, trEl)
        }
      }

      let colIdx: number | null = null
      const colAttrEl = target.closest('[data-col-index]') as HTMLElement | null
      if (colAttrEl) {
        const n = Number(colAttrEl.dataset.colIndex)
        if (Number.isFinite(n)) colIdx = n
      } else {
        const cell = target.closest('th, td') as HTMLElement | null
        if (cell?.parentElement?.tagName === 'TR') {
          colIdx = Array.prototype.indexOf.call(cell.parentElement.children, cell)
        }
      }

      if (rowIdx != null) setHoveredRow(rowIdx)
      else if (!onInsertLine) setHoveredRow(null)
      if (colIdx != null) setHoveredCol(colIdx)
      else if (!onInsertLine) setHoveredCol(null)
    }
    const onLeave = () => {
      setHoveredRow(null)
      setHoveredCol(null)
    }
    wrapper.addEventListener('mousemove', onMove)
    wrapper.addEventListener('mouseleave', onLeave)
    return () => {
      wrapper.removeEventListener('mousemove', onMove)
      wrapper.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  const selectThisContainer = (event: React.MouseEvent) => {
    const cp = resolveTablePos()
    if (cp == null) return
    event.preventDefault()
    event.stopPropagation()
    editor.commands.setNodeSelection(cp)
  }

  const handleAddRow = useCallback(
    (atIndex: number) => {
      const cp = resolveTablePos()
      if (cp == null) return
      addRowAt(editor, cp, atIndex)
    },
    [editor, resolveTablePos]
  )

  const handleAddColumn = useCallback(
    (atIndex: number) => {
      const cp = resolveTablePos()
      if (cp == null) return
      addColumnAt(editor, cp, atIndex)
    },
    [editor, resolveTablePos]
  )

  const handleRemoveRow = useCallback(
    (atIndex: number) => {
      const cp = resolveTablePos()
      if (cp == null) return
      removeRowAt(editor, cp, atIndex)
    },
    [editor, resolveTablePos]
  )

  const handleRemoveColumn = useCallback(
    (atIndex: number) => {
      const cp = resolveTablePos()
      if (cp == null) return
      removeColumnAt(editor, cp, atIndex)
    },
    [editor, resolveTablePos]
  )

  const handleToggleHeader = useCallback(() => {
    const cp = resolveTablePos()
    if (cp == null) return
    toggleHeaderRow(editor, cp)
  }, [editor, resolveTablePos])

  const dropState = getTableDrop()
  const dragState = getTableDrag()

  // Boundary positions for insert lines. Row boundary `i` sits at the top
  // edge of row `i`, except for the final boundary which sits at the bottom
  // edge of the last row. Same scheme for columns.
  const rowBoundaries: number[] = []
  for (const rect of rowRects) rowBoundaries.push(rect.top)
  const lastRowRect = rowRects[rowRects.length - 1]
  if (lastRowRect) rowBoundaries.push(lastRowRect.top + lastRowRect.height)

  const colBoundaries: number[] = []
  for (const rect of colRects) colBoundaries.push(rect.left)
  const lastColRect = colRects[colRects.length - 1]
  if (lastColRect) colBoundaries.push(lastColRect.left + lastColRect.width)

  // Drop-indicator geometry, resolved up front so the rect lookup is checked
  // once here instead of three times inside JSX.
  let columnDropLeft: number | null = null
  if (dropState?.kind === 'column') {
    const rect = colRects[dropState.index]
    if (rect) columnDropLeft = dropState.edge === 'before' ? rect.left : rect.left + rect.width
  }
  let rowDropTop: number | null = null
  if (dropState?.kind === 'row') {
    const rect = rowRects[dropState.index]
    if (rect) rowDropTop = dropState.edge === 'before' ? rect.top : rect.top + rect.height
  }

  return (
    <NodeViewWrapper as='div' className={blockStyles.blockWrapper} data-table=''>
      <div className={blockStyles.blockContainer}>
        <div
          className={blockStyles.lineGutter}
          contentEditable={false}
          draggable={true}
          data-block-drag-handle='true'
          onClick={selectThisContainer}>
          <div className={`${blockStyles.lineNumber} text-xs tabular-nums`}>{lineNumber ?? ''}</div>
        </div>

        <div
          className={`${blockStyles.blockContentWrapper} ${styles.containerContent} ${styles.tableContainerContent}`}>
          <div className={styles.tableToolbar} contentEditable={false}>
            <Tooltip
              content={hasHeaderRow ? 'Style first row as body' : 'Style first row as header'}
              side='top'>
              <button
                type='button'
                className={styles.tableToolbarToggle}
                aria-pressed={hasHeaderRow}
                aria-label={hasHeaderRow ? 'Style first row as body' : 'Style first row as header'}
                onClick={handleToggleHeader}>
                <PanelTop size={14} aria-hidden='true' />
              </button>
            </Tooltip>
          </div>

          <div className={styles.tableBodyCard} ref={wrapperRef}>
            {/* LEFT: per-row drag handle. Hidden on the header row — the
                header always stays at the top so its drag handle would be
                a no-op. */}
            <div className={styles.rowGutter} contentEditable={false}>
              {rowRects.map((rect, i) => {
                if (i === 0 && hasHeaderRow) return null
                return (
                  <RowDragHandle
                    key={`row-drag-${i}`}
                    index={i}
                    rect={rect}
                    isHovered={hoveredRow === i}
                    isSourceOfDrag={dragState?.kind === 'row' && dragState.index === i}
                    onDragStart={(e) => {
                      const cp = resolveTablePos()
                      const tableElNow = tableEl.current
                      if (cp == null || !tableElNow) return
                      e.stopPropagation()
                      startTableDrag({
                        kind: 'row',
                        index: i,
                        tablePos: cp,
                        editor,
                        tableEl: tableElNow,
                      })
                      if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', `row-${i}`)
                        // Drag preview: clone of just this row, wrapped in a
                        // mini offscreen <table> so cell borders render. Same
                        // offscreen-then-setTimeout pattern as panel-node-view.
                        // Sibling-index lookup; PM strips externally-set
                        // data attrs from tbody rows on every renderHTML.
                        const tr =
                          tableElNow
                            .querySelector(':scope > tbody')
                            ?.querySelectorAll<HTMLTableRowElement>(':scope > tr')[i] ?? null
                        if (tr) {
                          const cloneTable = document.createElement('table')
                          cloneTable.className = tableElNow.className
                          cloneTable.style.position = 'absolute'
                          cloneTable.style.top = '-10000px'
                          cloneTable.style.left = '-10000px'
                          cloneTable.style.width = `${Math.min(tableElNow.offsetWidth, 480)}px`
                          cloneTable.style.background = 'var(--color-background, white)'
                          cloneTable.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
                          cloneTable.style.opacity = '0.95'
                          // Editor table now uses `border-collapse: separate` so
                          // body cells can carry corner border-radius. Match it
                          // here so the dragged row shows full grid lines (cells
                          // own their right + bottom borders via the CSS module).
                          cloneTable.style.borderCollapse = 'separate'
                          cloneTable.style.borderSpacing = '0'
                          const cloneTbody = document.createElement('tbody')
                          cloneTbody.appendChild(tr.cloneNode(true))
                          cloneTable.appendChild(cloneTbody)
                          document.body.appendChild(cloneTable)
                          e.dataTransfer.setDragImage(cloneTable, 16, 16)
                          setTimeout(() => cloneTable.remove(), 0)
                        }
                      }
                    }}
                    onDragEndExternal={() => {
                      if (getTableDrag()?.index === i) endTableDrag()
                    }}
                  />
                )
              })}
            </div>

            {/* RIGHT: per-row delete (Trash). Hidden on the header row —
                same rule as the left drag handle (i === 0 && hasHeaderRow). */}
            <div className={styles.rowDeleteGutter} contentEditable={false}>
              {rowRects.map((rect, i) => {
                if (i === 0 && hasHeaderRow) return null
                return rowCount > 1 ? (
                  <RowDeleteButton
                    key={`row-delete-${i}`}
                    index={i}
                    rect={rect}
                    isHovered={hoveredRow === i}
                    onDelete={() => handleRemoveRow(i)}
                  />
                ) : null
              })}
            </div>

            {/* TOP: per-column drag handle. Lives OUTSIDE `.tableScroll`
                so it doesn't push the wrapper's content height past its
                visible bounds (which would otherwise trigger a vertical
                scrollbar via the spec's overflow-x/y coercion). Trade-off:
                won't pan with horizontal scroll on overflowing tables —
                acceptable for v1. */}
            <div
              className={styles.columnStrip}
              contentEditable={false}
              style={{ width: tableWidth ? `${tableWidth}px` : undefined }}>
              {colRects.map((rect, i) => (
                <ColumnDragHandle
                  key={`col-drag-${i}`}
                  index={i}
                  rect={rect}
                  isHovered={hoveredCol === i}
                  isSourceOfDrag={dragState?.kind === 'column' && dragState.index === i}
                  onDragStart={(e) => {
                    const cp = resolveTablePos()
                    const tableElNow = tableEl.current
                    if (cp == null || !tableElNow) return
                    e.stopPropagation()
                    startTableDrag({
                      kind: 'column',
                      index: i,
                      tablePos: cp,
                      editor,
                      tableEl: tableElNow,
                    })
                    if (e.dataTransfer) {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', `col-${i}`)
                      // Drag preview: clone the column's first cell.
                      // Sibling-index lookup since PM strips data attrs.
                      const firstRow = tableElNow.querySelector<HTMLElement>(':scope > tbody > tr')
                      const cell =
                        firstRow?.querySelectorAll<HTMLElement>(':scope > th, :scope > td')[i] ??
                        null
                      if (cell) {
                        const clone = cell.cloneNode(true) as HTMLElement
                        clone.style.position = 'absolute'
                        clone.style.top = '-10000px'
                        clone.style.left = '-10000px'
                        clone.style.maxWidth = '280px'
                        clone.style.background = 'var(--color-background, white)'
                        clone.style.border = '1px solid var(--color-border, #e5e7eb)'
                        clone.style.borderRadius = '4px'
                        clone.style.padding = '0.5rem 0.625rem'
                        clone.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
                        clone.style.opacity = '0.95'
                        document.body.appendChild(clone)
                        e.dataTransfer.setDragImage(clone, 16, 16)
                        setTimeout(() => clone.remove(), 0)
                      }
                    }
                  }}
                  onDragEndExternal={() => {
                    if (getTableDrag()?.index === i) endTableDrag()
                  }}
                />
              ))}
            </div>

            {/* BOTTOM: per-column delete strip. Also OUTSIDE `.tableScroll`. */}
            <div
              className={styles.colDeleteStrip}
              contentEditable={false}
              style={{ width: tableWidth ? `${tableWidth}px` : undefined }}>
              {colRects.map((rect, i) =>
                colCount > 1 ? (
                  <ColumnDeleteButton
                    key={`col-delete-${i}`}
                    index={i}
                    rect={rect}
                    isHovered={hoveredCol === i}
                    onDelete={() => handleRemoveColumn(i)}
                  />
                ) : null
              )}
            </div>

            <div className={styles.tableScroll}>
              {/* PM's `<tbody>` content DOM is appended here by setTableRef. */}
              <table className={styles.editorTable} ref={setTableRef} />
            </div>

            {/* Insert lines + drop indicators live OUTSIDE `.tableScroll`
                because that wrapper has `overflow-x: auto`, which (per CSS
                spec) coerces `overflow-y` to `auto` too — clipping the
                circular `+` buttons that hang past the table's edges at
                `-9px`. Positioning them as siblings of the row gutter
                anchors them to the body card (which has `overflow: visible`)
                and the rect measurements (computed against `wrapperRect`)
                still align them correctly. Trade-off: when the table
                overflows horizontally, column insert lines stay fixed to
                the body card's coordinate space rather than panning with
                the column. Acceptable for v1; address with a horizontal-
                scroll listener if needed. */}
            <div
              className={styles.rowInsertLines}
              contentEditable={false}
              style={{
                width: tableWidth ? `${tableWidth}px` : undefined,
                height: tableHeight ? `${tableHeight}px` : undefined,
              }}>
              {rowBoundaries.map((y, i) =>
                // Skip boundary 0 (top edge of row 0). Inserting a row
                // above the first row would land it above the header,
                // which we don't allow — the header always stays at the
                // top.
                i === 0 ? null : (
                  <RowInsertLine key={`row-boundary-${i}`} y={y} onInsert={() => handleAddRow(i)} />
                )
              )}
            </div>

            <div
              className={styles.colInsertLines}
              contentEditable={false}
              style={{
                width: tableWidth ? `${tableWidth}px` : undefined,
                height: tableHeight ? `${tableHeight}px` : undefined,
              }}>
              {colBoundaries.map((x, i) => (
                <ColumnInsertLine
                  key={`col-boundary-${i}`}
                  x={x}
                  onInsert={() => handleAddColumn(i)}
                />
              ))}
            </div>

            {columnDropLeft !== null ? (
              <div
                className={styles.columnDropIndicator}
                style={{
                  left: columnDropLeft,
                  height: tableHeight ? `${tableHeight}px` : undefined,
                }}
                aria-hidden='true'
              />
            ) : null}

            {rowDropTop !== null ? (
              <div
                className={styles.rowDropIndicator}
                style={{
                  top: rowDropTop,
                  width: tableWidth ? `${tableWidth}px` : undefined,
                }}
                aria-hidden='true'
              />
            ) : null}
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

interface RowDragHandleProps {
  index: number
  rect: RowRect
  isHovered: boolean
  isSourceOfDrag: boolean
  onDragStart: (e: React.DragEvent<HTMLSpanElement>) => void
  onDragEndExternal: () => void
}

function RowDragHandle({
  index,
  rect,
  isHovered,
  isSourceOfDrag,
  onDragStart,
  onDragEndExternal,
}: RowDragHandleProps) {
  return (
    <div
      className={styles.rowHandleRow}
      data-row-index={index}
      data-hovered={isHovered ? 'true' : undefined}
      style={{
        position: 'absolute',
        top: `${rect.top}px`,
        height: `${rect.height}px`,
        left: 0,
        width: '100%',
        opacity: isSourceOfDrag ? 0.5 : 1,
      }}>
      <span
        className={styles.rowHandle}
        aria-label={`Drag row ${index + 1}`}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEndExternal}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}>
        <GripVertical size={12} />
      </span>
    </div>
  )
}

interface RowDeleteButtonProps {
  index: number
  rect: RowRect
  isHovered: boolean
  onDelete: () => void
}

function RowDeleteButton({ index, rect, isHovered, onDelete }: RowDeleteButtonProps) {
  return (
    <div
      className={styles.rowDeleteRow}
      data-row-index={index}
      data-hovered={isHovered ? 'true' : undefined}
      style={{
        position: 'absolute',
        top: `${rect.top}px`,
        height: `${rect.height}px`,
        left: 0,
        width: '100%',
      }}>
      <button
        type='button'
        className={styles.rowDeleteButton}
        aria-label={`Delete row ${index + 1}`}
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}>
        <Trash2 size={14} />
      </button>
    </div>
  )
}

interface ColumnDragHandleProps {
  index: number
  rect: ColRect
  isHovered: boolean
  isSourceOfDrag: boolean
  onDragStart: (e: React.DragEvent<HTMLSpanElement>) => void
  onDragEndExternal: () => void
}

function ColumnDragHandle({
  index,
  rect,
  isHovered,
  isSourceOfDrag,
  onDragStart,
  onDragEndExternal,
}: ColumnDragHandleProps) {
  return (
    <div
      className={styles.colHandleCol}
      data-col-index={index}
      data-hovered={isHovered ? 'true' : undefined}
      style={{
        position: 'absolute',
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        top: 0,
        height: '100%',
        opacity: isSourceOfDrag ? 0.5 : 1,
      }}>
      <span
        className={styles.colHandle}
        aria-label={`Drag column ${index + 1}`}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEndExternal}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}>
        <GripHorizontal size={12} />
      </span>
    </div>
  )
}

interface ColumnDeleteButtonProps {
  index: number
  rect: ColRect
  isHovered: boolean
  onDelete: () => void
}

function ColumnDeleteButton({ index, rect, isHovered, onDelete }: ColumnDeleteButtonProps) {
  return (
    <div
      className={styles.colDeleteCol}
      data-col-index={index}
      data-hovered={isHovered ? 'true' : undefined}
      style={{
        position: 'absolute',
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        top: 0,
        height: '100%',
      }}>
      <button
        type='button'
        className={styles.colDeleteButton}
        aria-label={`Delete column ${index + 1}`}
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}>
        <Trash2 size={14} />
      </button>
    </div>
  )
}

interface RowInsertLineProps {
  y: number
  onInsert: () => void
}

function RowInsertLine({ y, onInsert }: RowInsertLineProps) {
  return (
    <div className={styles.rowInsertLine} style={{ top: `${y}px` }}>
      <button
        type='button'
        className={styles.insertLineButton}
        aria-label='Insert row'
        onClick={(e) => {
          e.stopPropagation()
          onInsert()
        }}>
        <PlusGlyph />
      </button>
      <div className={styles.rowInsertLineBar} aria-hidden='true' />
    </div>
  )
}

interface ColumnInsertLineProps {
  x: number
  onInsert: () => void
}

function ColumnInsertLine({ x, onInsert }: ColumnInsertLineProps) {
  return (
    <div className={styles.colInsertLine} style={{ left: `${x}px` }}>
      <button
        type='button'
        className={styles.insertLineButton}
        aria-label='Insert column'
        onClick={(e) => {
          e.stopPropagation()
          onInsert()
        }}>
        <PlusGlyph />
      </button>
      <div className={styles.colInsertLineBar} aria-hidden='true' />
    </div>
  )
}

// Same plus glyph as `article-insert-line.tsx` so the editor's table
// insert affordance and the sidebar's tree insert affordance look identical.
function PlusGlyph() {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      fill='none'
      viewBox='0 0 16 16'
      preserveAspectRatio='xMidYMid meet'
      width='10'
      height='10'
      style={{ verticalAlign: 'middle' }}>
      <path
        fill='currentColor'
        d='M8.6 3a.6.6 0 0 0-1.2 0v4.4H3a.6.6 0 0 0 0 1.2h4.4V13a.6.6 0 1 0 1.2 0V8.6H13a.6.6 0 1 0 0-1.2H8.6V3Z'
      />
    </svg>
  )
}

// Bail out of state updates when measurement produces identical rects.
// Without this, every measure() call creates new array references that
// React treats as a state change and re-renders, even when the values
// haven't actually moved — which can cycle if any child of the body card
// reacts to re-render with another DOM mutation.
function rectsEqual<T>(a: T[], b: T[], k1: keyof T, k2: keyof T): boolean {
  if (a.length !== b.length) return false
  for (const [i, av] of a.entries()) {
    const bv = b[i]
    if (!bv) return false
    if (av[k1] !== bv[k1] || av[k2] !== bv[k2]) return false
  }
  return true
}
