// apps/web/src/components/money/ui/line-builder/use-line-nav.ts

import { useEffect, useRef } from 'react'

type UseLineNavOptions = {
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Total navigable rows (real records + phantom drafts). */
  rowCount: number
  /** Navigable columns per row: 0 = name, 1 = qty, 2 = unit cost. */
  colCount: number
  /** Push a fresh phantom draft row. Called when nav lands past the last row. */
  onAddRow: () => void
  readOnly: boolean
}

/**
 * Spreadsheet-like keyboard navigation for the line-items grid — the
 * `use-key-value-navigation` idiom (data-connectors HTTP editor) ported to the
 * line builder. A single capture-phase `keydown` listener on the rows container
 * moves focus between cells tagged `data-line-row` / `data-line-col`:
 *
 * - Arrows cross cells only when the caret sits at the input's text boundary,
 *   so left/right editing inside a cell still works.
 * - Tab / Shift-Tab walk the grid; forward past the last cell adds a row.
 * - Enter commits (the focus move blurs the input) and drops into the next row's
 *   name cell — adding a fresh draft when already on the last row, so "keep
 *   adding items" is a pure-keyboard rhythm.
 *
 * Bails out while focus is inside a Radix popper (the catalog `/` picker), so the
 * picker's own arrow/enter keys are never hijacked.
 */
export function useLineNav({
  containerRef,
  rowCount,
  colCount,
  onAddRow,
  readOnly,
}: UseLineNavOptions) {
  const rowCountRef = useRef(rowCount)
  const onAddRowRef = useRef(onAddRow)
  rowCountRef.current = rowCount
  onAddRowRef.current = onAddRow

  useEffect(() => {
    const container = containerRef.current
    if (!container || readOnly) return

    function getActiveCell(): { row: number; col: number } | null {
      const active = document.activeElement
      if (!active || !container!.contains(active)) return null
      const cell = active.closest('[data-line-row][data-line-col]') as HTMLElement | null
      if (!cell) return null
      const row = Number.parseInt(cell.dataset.lineRow!, 10)
      const col = Number.parseInt(cell.dataset.lineCol!, 10)
      if (Number.isNaN(row) || Number.isNaN(col)) return null
      return { row, col }
    }

    function focusCell(row: number, col: number) {
      const target = container!.querySelector(
        `[data-line-row="${row}"][data-line-col="${col}"]`
      ) as HTMLElement | null
      if (!target) return
      // `[data-cell-focusable]` covers the name cell's at-rest text button (which
      // swaps to an <input> on focus); qty/unit-cost cells match on `input`.
      const focusable = target.querySelector(
        'input, textarea, [data-cell-focusable]'
      ) as HTMLElement | null
      if (focusable) {
        focusable.focus()
        focusable.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }

    function focusCellAfterAdd(row: number, col: number) {
      requestAnimationFrame(() => focusCell(row, col))
    }

    /** True while focus is inside the catalog `/` picker (a Radix popper portal). */
    function isInsidePopper(): boolean {
      const active = document.activeElement
      if (!active) return false
      return !!active.closest('[data-radix-popper-content-wrapper]')
    }

    /** Plain <input>/<textarea> caret-at-edge test (no contenteditable here). */
    function isCaretAtBoundary(direction: 'start' | 'end'): boolean {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (direction === 'start') return el.selectionStart === 0 && el.selectionEnd === 0
        const end = el.value.length
        return el.selectionStart === end && el.selectionEnd === end
      }
      return true
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (isInsidePopper()) return
      // The description sub-editor is a <textarea> — leave all its keys native
      // (Enter confirms, arrows move the caret), never grid-navigate from it.
      if (document.activeElement instanceof HTMLTextAreaElement) return

      const pos = getActiveCell()
      if (!pos) return

      const { row, col } = pos
      const totalRows = rowCountRef.current
      const totalCols = colCount

      switch (e.key) {
        case 'Enter': {
          e.preventDefault()
          if (row < totalRows - 1) {
            focusCell(row + 1, 0)
          } else {
            onAddRowRef.current()
            focusCellAfterAdd(row + 1, 0)
          }
          break
        }

        case 'ArrowDown': {
          e.preventDefault()
          if (row < totalRows - 1) {
            focusCell(row + 1, col)
          } else {
            onAddRowRef.current()
            focusCellAfterAdd(row + 1, col)
          }
          break
        }

        case 'ArrowUp': {
          if (row > 0) {
            e.preventDefault()
            focusCell(row - 1, col)
          }
          break
        }

        case 'ArrowLeft': {
          if (col > 0 && isCaretAtBoundary('start')) {
            e.preventDefault()
            focusCell(row, col - 1)
          }
          break
        }

        case 'ArrowRight': {
          if (col < totalCols - 1 && isCaretAtBoundary('end')) {
            e.preventDefault()
            focusCell(row, col + 1)
          }
          break
        }

        case 'Tab': {
          e.preventDefault()
          if (e.shiftKey) {
            if (col > 0) focusCell(row, col - 1)
            else if (row > 0) focusCell(row - 1, totalCols - 1)
          } else if (col < totalCols - 1) {
            focusCell(row, col + 1)
          } else if (row < totalRows - 1) {
            focusCell(row + 1, 0)
          } else {
            onAddRowRef.current()
            focusCellAfterAdd(row + 1, 0)
          }
          break
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => container.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [containerRef, colCount, readOnly])
}
