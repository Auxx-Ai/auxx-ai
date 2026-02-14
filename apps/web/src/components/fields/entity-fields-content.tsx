// apps/web/src/components/fields/entity-fields-content.tsx
'use client'

import { parseRecordId, type RecordId, type ResourceField } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import type { SensorDescriptor, SensorOptions } from '@dnd-kit/core'
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Pencil, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { AddFieldRow } from './add-field-row'
import { useFieldNavigation } from './field-navigation-context'
import { SortablePropertyRow } from './sortable-property-row'

/**
 * Props for EntityFieldsContent component (unified version)
 */
export interface EntityFieldsContentProps {
  className?: string
  isEditMode: boolean
  setIsEditMode: (value: boolean) => void
  dialogOpen: boolean
  setDialogOpen: (value: boolean) => void
  editingResourceFieldId: ResourceFieldId | null
  sensors: SensorDescriptor<SensorOptions>[]
  handleDragEnd: (event: DragEndEvent) => void
  /** Unified sorted fields (system + custom) */
  fields: ResourceField[]
  /** Loading state */
  isLoading: boolean
  /** Check if field is sortable */
  isSortable: (field: ResourceField) => boolean
  handleDeleteField: (fieldId: string, fieldName: string) => Promise<void>
  handleEditField: (fieldId: string, field: any) => void
  handleAddField: () => void
  handleProviderOpenChange: (providerId: string, nextOpen: boolean) => void
  registerProviderClose: (providerId: string, closeFn: () => void) => void
  unregisterProviderClose: (providerId: string) => void
  ConfirmDeleteDialog: React.FC
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
  /** Whether fields can be edited (default: true) */
  canEdit?: boolean
  /** Whether all fields are read-only (default: false) */
  readOnly?: boolean
  /** Whether to show field titles/labels (default: true) */
  showTitle?: boolean
  /** Callback after successful mutation */
  onMutationSuccess?: () => void
  /** Handler for toggling field visibility (only in edit mode) */
  onToggleVisibility?: (resourceFieldId: string, visible: boolean) => void
  /** Check if a field is visible */
  isFieldVisible?: (fieldId: string) => boolean
}

/**
 * Inner component that uses the navigation context
 * Renders the unified field list with drag-and-drop support
 */
export function EntityFieldsContent({
  className,
  isEditMode,
  setIsEditMode,
  dialogOpen,
  setDialogOpen,
  editingResourceFieldId,
  sensors,
  handleDragEnd,
  fields,
  isLoading,
  isSortable,
  handleDeleteField,
  handleEditField,
  handleAddField,
  handleProviderOpenChange,
  registerProviderClose,
  unregisterProviderClose,
  ConfirmDeleteDialog,
  recordId,
  onMutationSuccess,
  canEdit = true,
  readOnly = false,
  showTitle = true,
  onToggleVisibility,
  isFieldVisible,
}: EntityFieldsContentProps) {
  // Parse recordId to get entityDefinitionId
  const { entityDefinitionId } = parseRecordId(recordId)

  const containerRef = useRef<HTMLDivElement>(null)
  const { focusedRowId, moveFocus, openFocusedRow, isPopoverCapturing, registerOpenHandler } =
    useFieldNavigation()

  // Track open functions for each row
  const openHandlersRef = useRef<Map<string, () => void>>(new Map())

  /**
   * Register a callback to open a specific row by ID
   */
  const registerRowOpen = useCallback((providerId: string, openFn: () => void) => {
    openHandlersRef.current.set(providerId, openFn)
  }, [])

  /**
   * Unregister when row unmounts
   */
  const unregisterRowOpen = useCallback((providerId: string) => {
    openHandlersRef.current.delete(providerId)
  }, [])

  // Register the open handler with navigation context
  useEffect(() => {
    registerOpenHandler((rowId: string) => {
      const openFn = openHandlersRef.current.get(rowId)
      openFn?.()
    })
  }, [registerOpenHandler])

  /**
   * Handle keyboard navigation at container level
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isPopoverCapturing) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          moveFocus('down')
          break
        case 'ArrowUp':
          e.preventDefault()
          moveFocus('up')
          break
        case 'Enter':
          if (focusedRowId) {
            e.preventDefault()
            openFocusedRow()
          }
          break
      }
    },
    [isPopoverCapturing, moveFocus, focusedRowId, openFocusedRow]
  )

  // Filter sortable field IDs for DnD context (only custom fields)
  // Use field.id if available for custom fields, otherwise field.key
  const sortableIds = fields.filter((f) => !f.isSystem).map((f) => f.id || f.key)

  return (
    <>
      {/* Confirm delete dialog */}
      <ConfirmDeleteDialog />

      {/* Custom Field Dialog for creating/editing fields */}
      {dialogOpen && (
        <CustomFieldDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          resourceFieldId={editingResourceFieldId}
          entityDefinitionId={entityDefinitionId}
          onSuccess={onMutationSuccess}
        />
      )}

      {/* Styled card container with keyboard navigation */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          'group/entity-card bg-primary-100/50 dark:bg-[#23272e]/50 border rounded-2xl relative outline-none focus:outline-none',
          className
        )}>
        <div className='flex rounded-md gap-0 p-3 pe-2 self-stretch flex-col'>
          {/* Edit mode header */}
          {canEdit && (
            <div
              className={cn(
                'absolute -top-4 -right-3 z-80 rounded-full transition-opacity duration-200 ring ring-border bg-background flex items-center justify-center size-7 shadow-md backdrop-blur-sm',
                isEditMode ? 'opacity-100' : 'opacity-0 group-hover/entity-card:opacity-100'
              )}>
              <Button
                variant='ghost'
                size='icon-xs'
                onClick={() => setIsEditMode(!isEditMode)}
                className={cn(
                  'cursor-pointer',
                  isEditMode
                    ? 'bg-bad-200 hover:bg-bad-200 text-bad-700 hover:text-bad-800'
                    : 'text-muted-foreground hover:text-foreground'
                )}>
                {isEditMode ? <X /> : <Pencil />}
              </Button>
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis]}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {/* Render all fields in unified loop */}
              {fields.map((field, idx) => {
                const fieldKey = field.key
                const isSystemField = field.isSystem === true
                // Use field.id for custom fields (guaranteed unique DB ID), system-{key} for system fields
                const uniqueId = isSystemField ? `system-${fieldKey}` : field.id || fieldKey
                const providerId = uniqueId
                // const fieldEntry = fieldValues[fieldKey]
                const isReadOnly = field.capabilities.updatable === false

                return (
                  <SortablePropertyRow
                    key={uniqueId}
                    id={field.id || fieldKey}
                    providerId={providerId}
                    field={{
                      ...field,
                      // Ensure field has required properties for PropertyRow
                      id: field.id || fieldKey,
                      name: field.label,
                      readOnly: isReadOnly || readOnly,
                    }}
                    loading={isLoading}
                    isEditMode={isEditMode}
                    isSortable={isSortable(field)}
                    index={idx}
                    onDelete={isSystemField ? undefined : handleDeleteField}
                    onEdit={isSystemField ? undefined : handleEditField}
                    onOpenChange={handleProviderOpenChange}
                    registerClose={registerProviderClose}
                    unregisterClose={unregisterProviderClose}
                    registerOpen={registerRowOpen}
                    unregisterOpen={unregisterRowOpen}
                    recordId={recordId}
                    readOnly={readOnly}
                    showTitle={showTitle}
                    onToggleVisibility={isEditMode ? onToggleVisibility : undefined}
                    isVisible={
                      isFieldVisible?.(field.resourceFieldId ?? field.id ?? field.key) ?? true
                    }
                  />
                )
              })}
            </SortableContext>
          </DndContext>

          {/* Add Field row - only show in edit mode and when editable */}
          {isEditMode && canEdit && <AddFieldRow onClick={handleAddField} />}
        </div>
      </div>
    </>
  )
}
