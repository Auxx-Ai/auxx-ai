// apps/web/src/components/kanban/kanban-card-field.tsx
'use client'

import { memo, useState, useCallback, useRef } from 'react'
import { useFieldValue, toResourceId } from '~/components/resources/store/field-value-store'
import { renderCellValue, type CellConfig } from '~/components/dynamic-table'
import { CellFieldEditor } from '~/components/dynamic-table/components/cell-field-editor'
import { useCellSelectionOptional } from '~/components/dynamic-table/context/cell-selection-context'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import type { FieldType } from '@auxx/database/types'
import { EntityIcon } from '@auxx/ui/components/icons'
import type { CustomField } from '~/components/dynamic-table/types'
import { toResourceFieldId, toFieldId } from '@auxx/types/field'

/**
 * Props for KanbanCardField component
 */
interface KanbanCardFieldProps {
  /** Entity definition ID (e.g., 'contact', 'ticket', or custom entity UUID) */
  entityDefinitionId: string
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
  entityDefinitionId,
  rowId,
  field,
  editable = true,
  className,
}: KanbanCardFieldProps) {
  // Build resourceId for store lookups
  const resourceId = toResourceId(entityDefinitionId, rowId)

  // Direct store subscription - triggers re-render when value changes
  const { value, isLoading } = useFieldValue(resourceId, field.id)

  // Get cellSelectionConfig from context (same config used by table)
  const cellSelectionContext = useCellSelectionOptional()
  const cellSelectionConfig = cellSelectionContext?.cellSelectionConfig

  // Editing is only available if config exists, editable is true, and field is updatable
  const canEdit =
    editable && !!cellSelectionConfig?.enabled && field.capabilities.updatable !== false

  // Editing state (local to this field - kanban doesn't use selection like table)
  const [isEditing, setIsEditing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Column ID in ResourceFieldId format (entityDefinitionId:fieldId)
  const columnId = toResourceFieldId(entityDefinitionId, toFieldId(field.id))

  // Get iconId for field type
  const iconId = fieldTypeOptions[field.fieldType as FieldType]?.iconId ?? 'circle'

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
        !canEdit && field.capabilities.updatable === false && 'opacity-60',
        className
      )}
      onClick={handleClick}
      title={field.capabilities.updatable === false ? 'This field is read-only' : undefined}>
      {/* Field type icon */}
      <EntityIcon iconId={iconId} variant="default" size="xs" className="text-muted-foreground" />

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
