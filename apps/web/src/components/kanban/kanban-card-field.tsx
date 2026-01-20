// apps/web/src/components/kanban/kanban-card-field.tsx
'use client'

import { memo, useState, useCallback, useRef, useMemo } from 'react'
import { useFieldValue } from '~/components/resources/hooks/use-field-values'
import { toRecordId } from '~/components/resources/store/field-value-store'
import type { FieldReference, FieldPath, ResourceFieldId } from '@auxx/types/field'
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
import { decodeColumnId } from '~/components/dynamic-table/utils/column-id'
import { useField } from '~/components/resources/hooks/use-field'
import { ItemsCellView } from '~/components/ui/items-list-view'

/** Field types that already handle array values internally */
const MULTI_VALUE_FIELD_TYPES = new Set(['TAGS', 'MULTI_SELECT', 'RELATIONSHIP', 'ITEMS'])

/**
 * Props for KanbanCardField component
 */
interface KanbanCardFieldProps {
  /** Entity definition ID (e.g., 'contact', 'ticket', or custom entity UUID) */
  entityDefinitionId: string
  /** Row/record ID */
  rowId: string
  /**
   * Full field definition (includes options for rendering).
   * @deprecated Use columnId prop instead for unified handling
   */
  field?: CustomField
  /** Column ID - can be ResourceFieldId or encoded FieldPath (with ::) */
  columnId?: string
  /** Enable inline editing (default: true) */
  editable?: boolean
  /** Additional className */
  className?: string
}

/**
 * Kanban card field that subscribes directly to the Zustand store.
 * Uses the same cellRenderers as CustomFieldCell for consistent rendering.
 * Supports inline editing via CellFieldEditor using cellSelectionConfig from context.
 *
 * Supports both direct fields (via field prop) and field paths (via columnId prop).
 */
export const KanbanCardField = memo(function KanbanCardField({
  entityDefinitionId,
  rowId,
  field,
  columnId: columnIdProp,
  editable = true,
  className,
}: KanbanCardFieldProps) {
  // Build recordId for store lookups
  const recordId = toRecordId(entityDefinitionId, rowId)

  // Resolve columnId and FieldReference
  const { columnId, fieldRef, isPath } = useMemo(() => {
    // If columnId prop provided, decode it
    if (columnIdProp) {
      const decoded = decodeColumnId(columnIdProp)
      if (decoded.type === 'path') {
        return {
          columnId: columnIdProp,
          fieldRef: decoded.fieldPath as FieldReference,
          isPath: true,
        }
      }
      return {
        columnId: columnIdProp,
        fieldRef: decoded.resourceFieldId as FieldReference,
        isPath: false,
      }
    }
    // Fallback to field prop (legacy)
    if (field) {
      const resolvedColumnId = toResourceFieldId(entityDefinitionId, toFieldId(field.id))
      return {
        columnId: resolvedColumnId,
        fieldRef: resolvedColumnId as FieldReference,
        isPath: false,
      }
    }
    // Should not reach here - one of field or columnId must be provided
    throw new Error('KanbanCardField requires either field or columnId prop')
  }, [columnIdProp, field, entityDefinitionId])

  // Get target field metadata (last element for paths)
  const targetResourceFieldId = useMemo(() => {
    if (isPath) {
      const path = fieldRef as FieldPath
      return path[path.length - 1]
    }
    return fieldRef as ResourceFieldId
  }, [fieldRef, isPath])

  // Direct store subscription - triggers re-render when value changes
  const { value, isLoading } = useFieldValue(recordId, fieldRef, { autoFetch: true })

  // Get field metadata from store (for paths) or from prop (for direct fields)
  const storedField = useField(targetResourceFieldId)
  const resolvedField = field ?? storedField

  // Get cellSelectionConfig from context (same config used by table)
  const cellSelectionContext = useCellSelectionOptional()
  const cellSelectionConfig = cellSelectionContext?.cellSelectionConfig

  // Editing is only available for direct fields (not paths), config exists, and field is updatable
  const canEdit =
    !isPath &&
    editable &&
    !!cellSelectionConfig?.enabled &&
    resolvedField?.capabilities?.updatable !== false

  // Editing state (local to this field - kanban doesn't use selection like table)
  const [isEditing, setIsEditing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Get field type and icon
  const fieldType = resolvedField?.fieldType
  const iconId = fieldType
    ? (fieldTypeOptions[fieldType as FieldType]?.iconId ?? 'circle')
    : 'circle'

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
  const config: CellConfig = { options: resolvedField?.options }
  const isEmpty = value === null || value === undefined
  const type = fieldType ?? 'TEXT'

  // Check if value is array that needs special handling (for paths)
  const isArrayValue = Array.isArray(value)
  const fieldHandlesArrays = MULTI_VALUE_FIELD_TYPES.has(type)

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center gap-1.5 ps-3 pe-2',
        isEmpty && 'text-muted-foreground',
        canEdit && 'cursor-pointer hover:bg-primary-100 rounded-lg',
        !canEdit && resolvedField?.capabilities?.updatable === false && 'opacity-60',
        className
      )}
      onClick={handleClick}
      title={
        isPath
          ? 'Field paths are read-only'
          : resolvedField?.capabilities?.updatable === false
            ? 'This field is read-only'
            : undefined
      }>
      {/* Field type icon */}
      <EntityIcon iconId={iconId} variant="default" size="xs" className="text-muted-foreground" />

      {/* Value display or empty placeholder */}
      <div className="truncate flex-1 [&_[data-slot=expandable-cell]]:min-h-6.5 [&_[data-slot=expandable-cell-inner]]:min-h-6.5">
        {isEmpty ? (
          <span className="min-h-6.5 flex items-center text-primary-400 pl-3">No value</span>
        ) : isArrayValue && !fieldHandlesArrays && value.length > 0 ? (
          // Array values from paths that don't handle arrays internally
          <ItemsCellView
            items={value.map((v: unknown, i: number) => ({ id: String(i), value: v }))}
            renderItem={(item) => renderCellValue(item.value, type, undefined, config)}
          />
        ) : (
          renderCellValue(value, type, undefined, config)
        )}
      </div>

      {/* Editor popover - only renders when editing direct fields */}
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
