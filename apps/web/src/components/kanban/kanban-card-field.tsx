// apps/web/src/components/kanban/kanban-card-field.tsx
'use client'

import { memo, useState, useCallback, useRef } from 'react'
import {
  useCustomFieldValue,
  useCustomFieldValueLoading,
  type ResourceType,
} from '~/stores/custom-field-value-store'
import { renderCellValue, type CellConfig } from '~/components/dynamic-table'
import { CellFieldEditor } from '~/components/dynamic-table/components/cell-field-editor'
import { useCellSelectionOptional } from '~/components/dynamic-table/context/cell-selection-context'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import type { CustomField } from '~/components/dynamic-table/types'

/**
 * Props for KanbanCardField component
 */
interface KanbanCardFieldProps {
  /** Resource type for store subscription */
  resourceType: ResourceType
  /** Entity definition ID (required for 'entity' resourceType) */
  entityDefId?: string
  /** Row/record ID */
  rowId: string
  /** Full field definition (includes options for rendering) */
  field: CustomField
  /** Enable inline editing (default: true) */
  editable?: boolean
  /** Additional className */
  className?: string
}

/**
 * Kanban card field that subscribes directly to the Zustand store.
 * Uses the same cellRenderers as CustomFieldCell for consistent rendering.
 * Supports inline editing via CellFieldEditor using cellSelectionConfig from context.
 */
export const KanbanCardField = memo(function KanbanCardField({
  resourceType,
  entityDefId,
  rowId,
  field,
  editable = true,
  className,
}: KanbanCardFieldProps) {
  // Direct store subscription - triggers re-render when value changes
  const value = useCustomFieldValue(resourceType, rowId, field.id, entityDefId)
  const isLoading = useCustomFieldValueLoading(resourceType, rowId, field.id, entityDefId)

  // Get cellSelectionConfig from context (same config used by table)
  const cellSelectionContext = useCellSelectionOptional()
  const cellSelectionConfig = cellSelectionContext?.cellSelectionConfig

  // Editing is only available if config exists and editable is true
  const canEdit = editable && !!cellSelectionConfig?.enabled

  // Editing state (local to this field - kanban doesn't use selection like table)
  const [isEditing, setIsEditing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Column ID format matches table convention: field_${fieldId}
  const columnId = `field_${field.id}`

  // Get icon for field type
  const Icon = fieldTypeOptions.find((option) => option.value === field.fieldType)?.icon

  // Handle click to start editing
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!canEdit) return
      e.stopPropagation() // Prevent card click from firing
      setIsEditing(true)
    },
    [canEdit]
  )

  // Handle close editor
  const handleCloseEditor = useCallback(() => {
    setIsEditing(false)
  }, [])

  // Loading state
  if (isLoading && value === undefined) {
    return <Skeleton className="h-4 w-16" />
  }

  // Build config for renderers (pass field options)
  const config: CellConfig = { options: field.options }
  const isEmpty = value === null || value === undefined

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center gap-1.5 ps-3 pe-2',
        isEmpty && 'text-muted-foreground',
        canEdit && 'cursor-pointer hover:bg-primary-100 rounded-lg',
        className
      )}
      onClick={handleClick}>
      {/* Field type icon */}
      {Icon && <Icon className="size-3 text-muted-foreground shrink-0" />}

      {/* Value display or empty placeholder */}
      <div className="truncate flex-1 [&_[data-slot=expandable-cell]]:min-h-6.5 [&_[data-slot=expandable-cell-inner]]:min-h-6.5">
        {isEmpty ? (
          <span className="min-h-6.5 flex items-center text-primary-400 pl-3">No value</span>
        ) : (
          renderCellValue(value, field.fieldType, undefined, config)
        )}
      </div>

      {/* Editor popover - only renders when editing */}
      {isEditing && cellSelectionConfig && (
        <CellFieldEditor
          rowId={rowId}
          columnId={columnId}
          cellSelectionConfig={cellSelectionConfig}
          onClose={handleCloseEditor}
          anchorRef={containerRef}
        />
      )}
    </div>
  )
})
