// apps/web/src/components/dynamic-table/components/inline-cell-editor.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { cn } from '@auxx/ui/lib/utils'
import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { AiEditorSparkle } from '~/components/fields/ai-overlay/ai-editor-sparkle'
import { getInputComponentForFieldType } from '~/components/fields/inputs/get-input-component'
import { PropertyProvider, usePropertyContext } from '~/components/fields/property-provider'
import { useFieldPopoverHandlers } from '~/components/fields/use-field-popover-handlers'
import { useCellIndexerContext } from '../context/cell-indexer-context'
import { useRangeActions } from '../context/cell-selection-context'
import type { CellSelectionConfig } from '../types'
import { CellSelectionOverlay } from './cell-selection-overlay'

/** Context to signal inline editing mode to child input components */
const InlineEditorContext = createContext(false)

/**
 * Hook for input components to detect inline editing mode.
 * Used by TextInputField to enable autoWidth when editing inline in a table cell.
 */
export function useIsInlineEditor(): boolean {
  return useContext(InlineEditorContext)
}

interface InlineCellEditorProps {
  rowId: string
  columnId: string
  cellSelectionConfig: CellSelectionConfig
  onClose: () => void
}

/**
 * Inline cell editor - renders input directly in cell for inline-editable fields
 *
 * Unlike CellFieldEditor (popover), this renders an absolute overlay
 * that replaces the cell content during editing. Used for TEXT, NUMBER,
 * CURRENCY, EMAIL, and URL fields where inline editing feels more natural.
 *
 * Uses the same useFieldPopoverHandlers hook as CellFieldEditor to ensure
 * consistent save/cancel behavior.
 */
export function InlineCellEditor({
  rowId,
  columnId,
  cellSelectionConfig,
  onClose,
}: InlineCellEditorProps) {
  // Get field definition from config
  const field = cellSelectionConfig.getFieldDefinition?.(columnId)

  // Get recordId for optimistic updates (required)
  const recordId = useMemo<RecordId | undefined>(() => {
    return cellSelectionConfig.getRecordId?.(rowId)
  }, [cellSelectionConfig, rowId])

  if (!field || !recordId) {
    // No field definition or recordId - can't edit
    onClose()
    return null
  }

  return (
    <PropertyProvider
      providerId={`inline-${rowId}-${columnId}`}
      field={field}
      loading={false}
      recordId={recordId}>
      <InlineCellEditorInner rowId={rowId} columnId={columnId} onClose={onClose} />
    </PropertyProvider>
  )
}

/**
 * Inner component that consumes PropertyContext
 * Uses useFieldPopoverHandlers for consistent behavior with CellFieldEditor
 */
function InlineCellEditorInner({
  rowId,
  columnId,
  onClose,
}: {
  rowId: string
  columnId: string
  onClose: () => void
}) {
  const { field, recordId, value } = usePropertyContext()
  const containerRef = useRef<HTMLDivElement>(null)

  // Use shared handlers - SAME as CellFieldEditorInner
  const { handleOutsideEvent, handleEscapeKey } = useFieldPopoverHandlers({ onClose })

  // For "Enter advances to row below" — read indexer + selection actions.
  const indexer = useCellIndexerContext()
  const { setActiveCell } = useRangeActions()

  // Get input component from shared function
  const InputComponent = getInputComponentForFieldType(field.fieldType)

  // Text-like fields need padding adjustments for visual alignment
  const isTextLikeType = ['TEXT', 'RICH_TEXT', 'EMAIL', 'URL'].includes(field.fieldType)

  // Latest-callback refs so the document listeners (mounted ONCE) survive
  // re-renders triggered by `commitValue` etc. — without these, the effect
  // tears down and re-attaches mid-event, dropping the bubbled Enter before
  // it reaches `document`.
  const handlersRef = useRef({
    handleOutsideEvent,
    handleEscapeKey,
    onClose,
    rowId,
    columnId,
    indexer,
    setActiveCell,
  })
  handlersRef.current = {
    handleOutsideEvent,
    handleEscapeKey,
    onClose,
    rowId,
    columnId,
    indexer,
    setActiveCell,
  }

  // Click outside detection - capture phase so this fires before descendant cell
  // handlers can stopPropagation (matches Radix's dismissable-layer pattern).
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (!containerRef.current || containerRef.current.contains(e.target as Node)) return
      // Force blur on the focused input first so inputs that only commit their
      // parsed value at blur (currency, where the UI parses + fires onValueChange
      // in its blur handler) get a chance to save before commitAndClose reads
      // the tracked value.
      const active = document.activeElement
      if (active instanceof HTMLElement && containerRef.current.contains(active)) {
        active.blur()
      }
      handlersRef.current.handleOutsideEvent()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [])

  // Escape (cancel) and Enter (commit + exit edit mode + advance to row below).
  // Bubble-phase listener mounted ONCE; reads latest callbacks via `handlersRef`
  // so a re-render mid-event doesn't tear down the listener before the Enter
  // event finishes bubbling to document.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const h = handlersRef.current
      if (!containerRef.current) return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        h.handleEscapeKey()
        return
      }

      if (e.key === 'Enter' && !e.shiftKey && containerRef.current.contains(e.target as Node)) {
        // The input's own Enter handler (currency/number/text/email/url) already
        // ran and committed. Now exit edit mode and advance one row down.
        h.onClose()

        if (h.indexer) {
          const currentIdx = h.indexer.rowIdToIndex.get(h.rowId)
          if (currentIdx !== undefined) {
            const nextRowId = h.indexer.rowIds[currentIdx + 1]
            if (nextRowId) {
              h.setActiveCell({ rowId: nextRowId, columnId: h.columnId })
              return
            }
          }
        }
        // No next row — leave the active cell where it is.
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <InlineEditorContext.Provider value={true}>
      <div
        ref={containerRef}
        className={cn(
          'absolute left-0 top-0 z-20 min-w-full min-h-9 bg-background max-w-[280px] [&_[data-slot=input-group]]:w-auto [&_[data-slot=input-group]]:min-h-9 [&_[data-slot=input-group-control]]:pl-3 [&_input]:[field-sizing:content]',
          isTextLikeType && 'pt-[4px] pl-1'
        )}>
        <CellSelectionOverlay isSelected={false} isEditing={true} />
        <div className='w-full'>{InputComponent}</div>
        <AiEditorSparkle field={field} recordId={recordId} value={value} onTrigger={onClose} />
      </div>
    </InlineEditorContext.Provider>
  )
}
