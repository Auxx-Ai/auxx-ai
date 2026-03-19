// apps/web/src/components/workflow/nodes/core/http/hooks/use-key-value-navigation.ts

import { useEffect, useRef } from 'react'

type UseKeyValueNavigationOptions = {
  containerRef: React.RefObject<HTMLDivElement | null>
  rowCount: number
  colCount: number
  onAddRow: () => void
  readonly: boolean
}

/**
 * Spreadsheet-like keyboard navigation for the KeyValue grid.
 * Attaches a single keydown listener (capture phase) to the container so it
 * fires before TipTap or native inputs handle the event.
 */
export function useKeyValueNavigation({
  containerRef,
  rowCount,
  colCount,
  onAddRow,
  readonly,
}: UseKeyValueNavigationOptions) {
  const rowCountRef = useRef(rowCount)
  const onAddRowRef = useRef(onAddRow)
  rowCountRef.current = rowCount
  onAddRowRef.current = onAddRow

  useEffect(() => {
    const container = containerRef.current
    if (!container || readonly) return

    function getActiveCell(): { row: number; col: number } | null {
      const active = document.activeElement
      if (!active || !container!.contains(active)) return null
      const cell = active.closest('[data-kv-row][data-kv-col]') as HTMLElement | null
      if (!cell) return null
      const row = Number.parseInt(cell.dataset.kvRow!, 10)
      const col = Number.parseInt(cell.dataset.kvCol!, 10)
      if (Number.isNaN(row) || Number.isNaN(col)) return null
      return { row, col }
    }

    function focusCell(row: number, col: number) {
      const target = container!.querySelector(
        `[data-kv-row="${row}"][data-kv-col="${col}"]`
      ) as HTMLElement | null
      if (!target) return
      const focusable = target.querySelector(
        'input, [contenteditable="true"], select, button[role="combobox"]'
      ) as HTMLElement | null
      if (focusable) {
        focusable.focus()
        focusable.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }

    function focusCellAfterAdd(row: number, col: number) {
      requestAnimationFrame(() => focusCell(row, col))
    }

    function isInsideSelectPopover(): boolean {
      const active = document.activeElement
      if (!active) return false
      return !!active.closest('[data-radix-popper-content-wrapper]')
    }

    function isCursorAtBoundary(direction: 'start' | 'end'): boolean {
      const el = document.activeElement
      if (!el) return false

      // Plain input
      if (el instanceof HTMLInputElement) {
        if (direction === 'start') {
          return el.selectionStart === 0 && el.selectionEnd === 0
        }
        return el.selectionStart === el.value.length && el.selectionEnd === el.value.length
      }

      // Contenteditable (TipTap)
      const editable = el.closest('[contenteditable="true"]') as HTMLElement | null
      if (!editable) {
        return true
      }

      // Empty editor — cursor is at both boundaries
      const textContent = editable.textContent || ''
      if (textContent.length === 0) {
        return true
      }

      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) {
        return true
      }
      if (!selection.isCollapsed) {
        return false
      }

      const range = selection.getRangeAt(0)

      if (direction === 'start') {
        const startContainer = range.startContainer

        if (startContainer.nodeType === Node.TEXT_NODE) {
          if (range.startOffset !== 0) return false
          let node: Node | null = startContainer
          while (node && node !== editable) {
            let sibling = node.previousSibling
            while (sibling) {
              if ((sibling.textContent?.length ?? 0) > 0) return false
              sibling = sibling.previousSibling
            }
            node = node.parentNode
          }
          return true
        }

        // Element node — check if all children before offset have no text
        const children = startContainer.childNodes
        for (let i = 0; i < range.startOffset; i++) {
          if ((children[i].textContent?.length ?? 0) > 0) return false
        }
        let node: Node | null = startContainer
        while (node && node !== editable) {
          let sibling = node.previousSibling
          while (sibling) {
            if ((sibling.textContent?.length ?? 0) > 0) return false
            sibling = sibling.previousSibling
          }
          node = node.parentNode
        }
        return true
      }

      // direction === 'end'
      // Check if all content after the cursor is empty (no text).
      // TipTap adds decorative nodes (IMG spacers, BR) that have no text content.
      const endContainer = range.endContainer
      const endOffset = range.endOffset

      // For text nodes, check if cursor is at end of text
      if (endContainer.nodeType === Node.TEXT_NODE) {
        const textLen = endContainer.textContent?.length ?? 0
        if (endOffset !== textLen) return false
        // Check remaining siblings up to editable root have no text
        let node: Node | null = endContainer
        while (node && node !== editable) {
          let sibling = node.nextSibling
          while (sibling) {
            if ((sibling.textContent?.length ?? 0) > 0) return false
            sibling = sibling.nextSibling
          }
          node = node.parentNode
        }
        return true
      }

      // For element nodes (cursor between child nodes), check remaining children have no text
      const children = endContainer.childNodes
      for (let i = endOffset; i < children.length; i++) {
        if ((children[i].textContent?.length ?? 0) > 0) return false
      }
      // Walk up and check remaining siblings
      let node: Node | null = endContainer
      while (node && node !== editable) {
        let sibling = node.nextSibling
        while (sibling) {
          if ((sibling.textContent?.length ?? 0) > 0) return false
          sibling = sibling.nextSibling
        }
        node = node.parentNode
      }
      return true
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (isInsideSelectPopover()) return

      const pos = getActiveCell()
      if (!pos) return

      const { row, col } = pos
      const totalRows = rowCountRef.current
      const totalCols = colCount

      switch (e.key) {
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
          const atStart = isCursorAtBoundary('start')
          if (col > 0 && atStart) {
            e.preventDefault()
            focusCell(row, col - 1)
          }
          break
        }

        case 'ArrowRight': {
          const atEnd = isCursorAtBoundary('end')
          if (col < totalCols - 1 && atEnd) {
            e.preventDefault()
            focusCell(row, col + 1)
          }
          break
        }

        case 'Tab': {
          e.preventDefault()
          if (e.shiftKey) {
            // Move backward
            if (col > 0) {
              focusCell(row, col - 1)
            } else if (row > 0) {
              focusCell(row - 1, totalCols - 1)
            }
          } else {
            // Move forward
            if (col < totalCols - 1) {
              focusCell(row, col + 1)
            } else if (row < totalRows - 1) {
              focusCell(row + 1, 0)
            } else {
              onAddRowRef.current()
              focusCellAfterAdd(row + 1, 0)
            }
          }
          break
        }

        case 'Escape': {
          const active = document.activeElement as HTMLElement | null
          active?.blur()
          break
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => container.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [containerRef, colCount, readonly])
}
