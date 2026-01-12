// apps/web/src/components/dynamic-table/components/inline-cell-editor.tsx
'use client'

import { useMemo, useRef, useEffect, createContext, useContext } from 'react'
import type { CellSelectionConfig } from '../types'
import { PropertyProvider, usePropertyContext } from '~/components/fields/property-provider'
import { useFieldPopoverHandlers } from '~/components/fields/use-field-popover-handlers'
import { getInputComponentForFieldType } from '~/components/fields/inputs/get-input-component'
import { CellSelectionOverlay } from './cell-selection-overlay'
import { cn } from '@auxx/ui/lib/utils'
import type { ResourceId } from '@auxx/lib/resources/client'

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
 * and CURRENCY fields where inline editing feels more natural.
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

  // Get resourceId for optimistic updates (required)
  const resourceId = useMemo<ResourceId | undefined>(() => {
    return cellSelectionConfig.getResourceId?.(rowId)
  }, [cellSelectionConfig, rowId])

  if (!field || !resourceId) {
    // No field definition or resourceId - can't edit
    onClose()
    return null
  }

  return (
    <PropertyProvider
      providerId={`inline-${rowId}-${columnId}`}
      field={field}
      loading={false}
      resourceId={resourceId}>
      <InlineCellEditorInner onClose={onClose} />
    </PropertyProvider>
  )
}

/**
 * Inner component that consumes PropertyContext
 * Uses useFieldPopoverHandlers for consistent behavior with CellFieldEditor
 */
function InlineCellEditorInner({ onClose }: { onClose: () => void }) {
  const { field } = usePropertyContext()
  const containerRef = useRef<HTMLDivElement>(null)

  // Use shared handlers - SAME as CellFieldEditorInner
  const { handleOutsideEvent, handleEscapeKey } = useFieldPopoverHandlers({ onClose })

  // Get input component from shared function
  const InputComponent = getInputComponentForFieldType(field.fieldType)

  // TEXT/RICH_TEXT need padding adjustments for visual alignment
  const isTextType = field.fieldType === 'TEXT' || field.fieldType === 'RICH_TEXT'

  // Click outside detection - wired to shared handler
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleOutsideEvent()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [handleOutsideEvent])

  // Escape key detection - wired to shared handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        handleEscapeKey()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleEscapeKey])

  return (
    <InlineEditorContext.Provider value={true}>
      <div
        ref={containerRef}
        className={cn(
          'absolute left-0 top-0 z-20 min-w-full min-h-9 bg-background max-w-[280px] [&_[data-slot=input-group]]:w-auto [&_[data-slot=input-group]]:min-h-9 [&_[data-slot=input-group-control]]:pl-3 [&_input]:[field-sizing:content]',
          isTextType && 'pt-[4px] pl-1'
        )}>
        <CellSelectionOverlay isSelected={false} isEditing={true} />
        <div className="w-full">{InputComponent}</div>
      </div>
    </InlineEditorContext.Provider>
  )
}
