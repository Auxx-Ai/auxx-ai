// apps/web/src/components/dynamic-table/hooks/use-cell-clipboard.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef } from 'react'
import { useSelectionStore } from '../stores/selection-store'
import type { CellAddress, CellSelectionConfig, CopyCellPayload, RangeEndpoint } from '../types'
import { type CoerceReason, coerceForPaste, reasonToLabel } from '../utils/cell-coercion'
import { rangeBounds } from '../utils/range'
import type { CellIndexer } from './use-cell-indexer'

interface UseCellClipboardOptions {
  tableId: string
  enabled: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  config?: CellSelectionConfig
  indexer: CellIndexer
}

/**
 * Feature flag — whether to write a second MIME (JSON sidecar) to the clipboard
 * alongside the plain-text TSV. When on, auxx→auxx paste can reconstruct typed
 * values losslessly across tabs/windows. When off, we only write plain text and
 * paste falls back to parsing the TSV (still lossless within the same tab if
 * we later add a module-level stash).
 *
 * Trade-off: the dual-MIME path triggers Chromium's "Allow site to see
 * clipboard contents?" permission prompt. Flip this to `true` when we're
 * confident that prompt is acceptable UX.
 */
const USE_DUAL_MIME_CLIPBOARD = false

/**
 * Custom MIME for the auxx JSON sidecar. The `web ` prefix opts into Chromium's
 * Web Custom Formats proposal, which lets us put structured data on the
 * clipboard alongside the plain-text view. Safari/Firefox that don't support
 * the custom format reject the whole `write()` call — we fall back to
 * `writeText()` in that case.
 */
const AUXX_CLIPBOARD_MIME = 'web text/auxx-tsv+json'

/**
 * Shape of the JSON sidecar. Phase 2c paste will parse this to reconstruct
 * typed values losslessly when pasting back into auxx. Versioned so we can
 * evolve the shape without breaking existing clipboard contents.
 */
interface ClipboardSidecar {
  version: 1
  rows: CopyCellPayload[][]
}

/**
 * Fallback TSV formatter used when `formatCellForCopy` isn't wired up.
 * Tabs and newlines inside strings would break the format, so we replace
 * them with spaces.
 */
function fallbackFormat(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(fallbackFormat).join(', ')
  try {
    return JSON.stringify(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
  } catch {
    return String(value)
  }
}

/** TSV-safe version of a display string (strip structural chars). */
function sanitizeForTsv(s: string): string {
  return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
}

/**
 * Write to clipboard with the dual-MIME payload when possible; fall back to
 * plain text otherwise. Safari historically rejects unknown MIME types, and
 * the whole `write()` call fails — the catch covers that.
 */
async function writeDualClipboard(tsv: string, sidecar: ClipboardSidecar) {
  if (
    USE_DUAL_MIME_CLIPBOARD &&
    typeof ClipboardItem !== 'undefined' &&
    navigator.clipboard?.write
  ) {
    try {
      const json = JSON.stringify(sidecar)
      const item = new ClipboardItem({
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
        [AUXX_CLIPBOARD_MIME]: new Blob([json], { type: AUXX_CLIPBOARD_MIME }),
      })
      await navigator.clipboard.write([item])
      return
    } catch {
      // fall through to writeText
    }
  }
  await navigator.clipboard.writeText(tsv)
}

/**
 * Hook: wires Cmd/Ctrl+C and Delete/Backspace to the active range.
 * Mounts a document-level listener that gates on the scroll container.
 *
 * Phase 2b: copy writes dual-MIME (text/plain TSV + JSON sidecar). Paste
 * (2c) will consume the sidecar when present for lossless round-trip.
 */
export function useCellClipboard({
  tableId,
  enabled,
  scrollContainerRef,
  config,
  indexer,
}: UseCellClipboardOptions) {
  const handleCopy = useCallback(async () => {
    if (!config) return
    const range = useSelectionStore.getState().getRange(tableId)
    if (!range) return

    const bounds = rangeBounds(range)
    const tsvLines: string[] = []
    const sidecarRows: CopyCellPayload[][] = []

    for (let r = bounds.top; r <= bounds.bottom; r++) {
      const rowId = indexer.rowIds[r]
      if (!rowId) continue
      const tsvCols: string[] = []
      const sidecarCols: CopyCellPayload[] = []
      for (let c = bounds.left; c <= bounds.right; c++) {
        const columnId = indexer.columnIds[c]
        if (!columnId) {
          tsvCols.push('')
          sidecarCols.push({ display: '' })
          continue
        }
        let payload: CopyCellPayload | null | undefined
        try {
          payload = config.formatCellForCopy?.(rowId, columnId)
        } catch {
          payload = null
        }
        if (payload) {
          tsvCols.push(sanitizeForTsv(payload.display))
          sidecarCols.push(payload)
        } else {
          const raw = config.getCellValue?.(rowId, columnId)
          const display = fallbackFormat(raw)
          tsvCols.push(display)
          sidecarCols.push({ display, raw })
        }
      }
      tsvLines.push(tsvCols.join('\t'))
      sidecarRows.push(sidecarCols)
    }

    const tsv = tsvLines.join('\n')
    const sidecar: ClipboardSidecar = { version: 1, rows: sidecarRows }

    try {
      await writeDualClipboard(tsv, sidecar)
    } catch (err) {
      toastError({
        title: 'Could not copy',
        description: err instanceof Error ? err.message : 'Clipboard access denied',
      })
    }
  }, [config, tableId, indexer])

  const handleDelete = useCallback(async () => {
    if (!config?.clearCells) return
    const range = useSelectionStore.getState().getRange(tableId)
    if (!range) return

    const bounds = rangeBounds(range)
    const cells: CellAddress[] = []
    for (let r = bounds.top; r <= bounds.bottom; r++) {
      const rowId = indexer.rowIds[r]
      if (!rowId) continue
      for (let c = bounds.left; c <= bounds.right; c++) {
        const columnId = indexer.columnIds[c]
        if (!columnId) continue
        const field = config.getFieldDefinition?.(columnId)
        if (field && field.capabilities?.updatable === false) continue
        cells.push({ rowId, columnId })
      }
    }
    if (cells.length === 0) return

    try {
      const result = await config.clearCells(cells)
      if (result.skipped > 0) {
        toastError({
          title: 'Some cells were skipped',
          description: `${result.skipped} cell${result.skipped === 1 ? '' : 's'} could not be cleared (read-only).`,
        })
      }
    } catch (err) {
      toastError({
        title: 'Error clearing cells',
        description: err instanceof Error ? err.message : 'Could not clear selected cells',
      })
    }
  }, [config, tableId, indexer])

  /** Hidden textarea that receives the native `paste` event. */
  const pasteTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  /** Refocus the active cell after paste so subsequent keyboard actions work. */
  const refocusActiveCell = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const range = useSelectionStore.getState().getRange(tableId)
    if (!range) return
    const cell = container.querySelector(
      `[data-row-id="${CSS.escape(range.anchor.rowId)}"][data-column-id="${CSS.escape(range.anchor.columnId)}"]`
    ) as HTMLElement | null
    cell?.focus()
  }, [scrollContainerRef, tableId])

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (!config?.saveCells) return
      const range = useSelectionStore.getState().getRange(tableId)
      if (!range) return

      const anchor = range.anchor
      const sidecarJson = e.clipboardData?.getData(AUXX_CLIPBOARD_MIME) ?? ''
      const plainText = e.clipboardData?.getData('text/plain') ?? ''
      const rows = parseClipboardRows(sidecarJson, plainText)
      if (rows.length === 0) return

      const { rowIds, columnIds } = indexer
      const updates: Array<{ rowId: string; columnId: string; value: unknown }> = []
      const reasons = new Map<CoerceReason | 'out-of-bounds' | 'no-field', number>()
      const bump = (r: CoerceReason | 'out-of-bounds' | 'no-field') =>
        reasons.set(r, (reasons.get(r) ?? 0) + 1)
      let skipped = 0

      // If paste is a single cell into a multi-cell range → fill the entire range.
      const firstRow = rows[0] ?? []
      const isSingleSourceCell = rows.length === 1 && firstRow.length === 1
      const singleSource = firstRow[0]
      const rangeBoundsVal = rangeBounds(range)
      const fillRows = isSingleSourceCell
        ? rangeBoundsVal.bottom - rangeBoundsVal.top + 1
        : rows.length
      const fillCols = isSingleSourceCell
        ? rangeBoundsVal.right - rangeBoundsVal.left + 1
        : Math.max(...rows.map((r) => r.length))
      const startRow = isSingleSourceCell ? rangeBoundsVal.top : anchor.rowIndex
      const startCol = isSingleSourceCell ? rangeBoundsVal.left : anchor.colIndex

      for (let r = 0; r < fillRows; r++) {
        const sourceRow = isSingleSourceCell ? firstRow : rows[r]
        if (!sourceRow) continue
        const targetRowIdx = startRow + r
        if (targetRowIdx < 0 || targetRowIdx >= rowIds.length) {
          skipped += isSingleSourceCell ? fillCols : sourceRow.length
          for (let k = 0; k < (isSingleSourceCell ? fillCols : sourceRow.length); k++) {
            bump('out-of-bounds')
          }
          continue
        }
        const targetRowId = rowIds[targetRowIdx]
        if (!targetRowId) continue
        const colsThisRow = isSingleSourceCell ? fillCols : sourceRow.length
        for (let c = 0; c < colsThisRow; c++) {
          const source = isSingleSourceCell ? singleSource : sourceRow[c]
          if (!source) {
            skipped++
            bump('no-field')
            continue
          }
          const targetColIdx = startCol + c
          if (targetColIdx < 0 || targetColIdx >= columnIds.length) {
            skipped++
            bump('out-of-bounds')
            continue
          }
          const targetColId = columnIds[targetColIdx]
          if (!targetColId) {
            skipped++
            bump('no-field')
            continue
          }
          const field = config.getFieldDefinition?.(targetColId)
          if (!field) {
            skipped++
            bump('no-field')
            continue
          }
          const result = coerceForPaste(source, field, {
            columnId: targetColId,
            resolveRelationshipByDisplay: config.resolveRelationshipByDisplay,
            resolveActorByDisplay: config.resolveActorByDisplay,
          })
          if (result.ok) {
            updates.push({ rowId: targetRowId, columnId: targetColId, value: result.value })
          } else {
            skipped++
            bump(result.reason)
          }
        }
      }

      if (updates.length > 0) {
        try {
          const saveResult = await config.saveCells(updates)
          if (saveResult.skipped > 0) {
            skipped += saveResult.skipped
            bump('read-only')
          }
        } catch (err) {
          toastError({
            title: 'Error pasting',
            description: err instanceof Error ? err.message : 'Could not paste values',
          })
          return
        }
      }

      // Expand the selection to cover the written rectangle so the user can
      // see where the paste landed.
      if (updates.length > 0) {
        const lastRowIdx = Math.min(startRow + fillRows - 1, rowIds.length - 1)
        const lastColIdx = Math.min(startCol + fillCols - 1, columnIds.length - 1)
        const focusRowId = rowIds[lastRowIdx]
        const focusColId = columnIds[lastColIdx]
        if (focusRowId && focusColId) {
          const newFocus: RangeEndpoint = {
            rowId: focusRowId,
            columnId: focusColId,
            rowIndex: lastRowIdx,
            colIndex: lastColIdx,
          }
          useSelectionStore.getState().setRangeFocus(tableId, newFocus)
        }
      }

      if (skipped > 0) {
        const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]
        const topReason = top
          ? top[0] === 'out-of-bounds'
            ? 'beyond table bounds'
            : top[0] === 'no-field'
              ? 'unknown column'
              : reasonToLabel(top[0])
          : 'unknown'
        toastError({
          title: `${skipped} cell${skipped === 1 ? '' : 's'} skipped`,
          description: `Most common reason: ${topReason}`,
        })
      }
    },
    [config, tableId, indexer]
  )

  // Mount a hidden textarea inside the scroll container. The native `paste`
  // event gives us reliable access to `clipboardData` including our custom
  // MIME type — `navigator.clipboard.read()` doesn't.
  useEffect(() => {
    if (!enabled) return
    const container = scrollContainerRef.current
    if (!container) return

    const textarea = document.createElement('textarea')
    textarea.setAttribute('aria-hidden', 'true')
    textarea.setAttribute('data-auxx-paste-sink', '')
    textarea.tabIndex = -1
    Object.assign(textarea.style, {
      position: 'absolute',
      left: '-9999px',
      top: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    })
    container.appendChild(textarea)
    pasteTextareaRef.current = textarea

    const pasteHandler = async (e: ClipboardEvent) => {
      e.preventDefault()
      try {
        await handlePaste(e)
      } finally {
        textarea.value = ''
        refocusActiveCell()
      }
    }
    textarea.addEventListener('paste', pasteHandler)

    return () => {
      textarea.removeEventListener('paste', pasteHandler)
      if (textarea.parentNode) textarea.parentNode.removeChild(textarea)
      if (pasteTextareaRef.current === textarea) pasteTextareaRef.current = null
    }
  }, [enabled, scrollContainerRef, handlePaste, refocusActiveCell])

  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      const isInterestingKey =
        (isMod && (e.key === 'c' || e.key === 'C' || e.key === 'v' || e.key === 'V')) ||
        e.key === 'Delete' ||
        e.key === 'Backspace'

      if (!isInterestingKey) return

      const target = e.target as HTMLElement | null
      // Don't hijack when the user is typing in a real input/textarea/contentEditable.
      // Our own hidden paste sink is allowed through.
      if (target) {
        const tag = target.tagName
        const isOurSink = target.hasAttribute?.('data-auxx-paste-sink')
        if (!isOurSink && (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable)) {
          return
        }
      }
      // Don't fire while a cell is in edit mode.
      const editing = useSelectionStore.getState().getEditingCell(tableId)
      if (editing) return
      // Gate on range presence, not DOM position. When a range is active,
      // the table owns these shortcuts even if focus is on the body.
      const range = useSelectionStore.getState().getRange(tableId)
      if (!range) return

      if (isMod && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        void handleCopy()
        return
      }
      if (isMod && (e.key === 'v' || e.key === 'V')) {
        const textarea = pasteTextareaRef.current
        if (!textarea) return
        // Don't preventDefault — let the browser deliver the paste event to
        // the textarea we just focused.
        textarea.value = ''
        textarea.focus()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        void handleDelete()
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [enabled, tableId, handleCopy, handleDelete])
}

/**
 * Parse clipboard contents into a 2D grid of CopyCellPayload.
 * Prefers the JSON sidecar when present; falls back to plain-text TSV.
 */
function parseClipboardRows(sidecarJson: string, plainText: string): CopyCellPayload[][] {
  if (sidecarJson) {
    try {
      const parsed = JSON.parse(sidecarJson) as ClipboardSidecar
      if (parsed?.version === 1 && Array.isArray(parsed.rows)) {
        return parsed.rows
      }
    } catch {
      // fall through to text
    }
  }
  if (!plainText) return []
  // Split on \r\n or \n. Trailing newline → drop empty last row.
  const lines = plainText.replace(/\r\n/g, '\n').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.map((line) => line.split('\t').map((cell) => ({ display: cell })))
}
