// apps/web/src/components/fields/entity-fields-content.tsx
'use client'

import React, { useRef, useCallback, useEffect } from 'react'
import { Pencil, X } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import type { SensorDescriptor, SensorOptions } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { Button } from '@auxx/ui/components/button'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { SortablePropertyRow } from './sortable-property-row'
import { AddFieldRow } from './add-field-row'
import { cn } from '@auxx/ui/lib/utils'
import { useFieldNavigation } from './field-navigation-context'
import type { StoreConfig } from './property-provider'
import type { StoredFieldValue } from '~/stores/custom-field-value-store'

/**
 * Props for EntityFieldsContent component
 */
export interface EntityFieldsContentProps {
  className?: string
  isEditMode: boolean
  setIsEditMode: (value: boolean) => void
  dialogOpen: boolean
  setDialogOpen: (value: boolean) => void
  editingField: any | null
  handleSaveField: (fieldData: any) => Promise<void>
  isPending: boolean
  currentResourceId: string
  sensors: SensorDescriptor<SensorOptions>[]
  handleDragEnd: (event: DragEndEvent) => Promise<void>
  sortedCustomFields: any[]
  isEntityInstance: boolean
  builtInFieldsWithOptions: any[]
  builtInValues: Record<string, StoredFieldValue>
  handleBuiltInFieldMutate: (fieldId: string) => (value: any) => Promise<void>
  entityLoading: boolean
  optionsLoading: boolean
  handleProviderOpenChange: (providerId: string, nextOpen: boolean) => void
  registerProviderClose: (providerId: string, closeFn: () => void) => void
  unregisterProviderClose: (providerId: string) => void
  fieldValues: Record<string, { valueId?: string; value: StoredFieldValue }>
  handleFieldMutate: (fieldId: string) => (value: any) => Promise<any>
  isLoadingValues: boolean
  isSortable: (field: any, isBuiltIn: boolean) => boolean
  handleDeleteField: (fieldId: string, fieldName: string) => Promise<void>
  handleEditField: (fieldId: string, field: any) => void
  systemFields: any[]
  handleAddField: () => void
  ConfirmDeleteDialog: React.FC
  /** Store configuration for bi-directional sync with table */
  storeConfig?: StoreConfig
}

/**
 * Inner component that uses the navigation context
 * Renders the field list with drag-and-drop support
 */
export function EntityFieldsContent({
  className,
  isEditMode,
  setIsEditMode,
  dialogOpen,
  setDialogOpen,
  editingField,
  handleSaveField,
  isPending,
  currentResourceId,
  sensors,
  handleDragEnd,
  sortedCustomFields,
  isEntityInstance,
  builtInFieldsWithOptions,
  builtInValues,
  handleBuiltInFieldMutate,
  entityLoading,
  optionsLoading,
  handleProviderOpenChange,
  registerProviderClose,
  unregisterProviderClose,
  fieldValues,
  handleFieldMutate,
  isLoadingValues,
  isSortable,
  handleDeleteField,
  handleEditField,
  systemFields,
  handleAddField,
  ConfirmDeleteDialog,
  storeConfig,
}: EntityFieldsContentProps) {
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
   * Arrow keys navigate between rows, Enter opens focused row
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // If a popover is capturing keys (Tags, Select, Date), let it handle
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

  return (
    <>
      {/* Confirm delete dialog */}
      <ConfirmDeleteDialog />

      {/* Custom Field Dialog for creating/editing fields */}
      <CustomFieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingField={editingField}
        onSave={handleSaveField}
        isPending={isPending}
        currentResourceId={currentResourceId}
      />

      {/* Styled card container with keyboard navigation */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          'group/entity-card bg-primary-100/50 dark:bg-primary-100 border rounded-2xl relative outline-none focus:outline-none',
          className
        )}>
        <div className="flex rounded-md gap-0 p-3 pe-2 self-stretch flex-col">
          {/* Edit mode header */}
          <div
            className={cn(
              'absolute -top-4 -right-3 z-80 rounded-full transition-opacity duration-200 ring ring-border bg-background flex items-center justify-center size-7 shadow-md backdrop-blur-sm',
              isEditMode ? 'opacity-100' : 'opacity-0 group-hover/entity-card:opacity-100'
            )}>
            <Button
              variant="ghost"
              size="icon-xs"
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

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis]}>
            <SortableContext
              items={sortedCustomFields.map((f) => f.id)}
              strategy={verticalListSortingStrategy}>
              {/* Render built-in fields first (only for non-entity instances) */}
              {!isEntityInstance &&
                builtInFieldsWithOptions.map((field, idx) => (
                  <SortablePropertyRow
                    key={`builtin-${field.id}`}
                    id={`builtin-${field.id}`}
                    providerId={`builtin-${field.id}`}
                    field={field}
                    value={builtInValues[field.id]}
                    mutate={handleBuiltInFieldMutate(field.id)}
                    loading={
                      entityLoading ||
                      optionsLoading ||
                      !Object.prototype.hasOwnProperty.call(builtInValues, field.id)
                    }
                    isEditMode={isEditMode}
                    isSortable={false}
                    index={idx}
                    onOpenChange={handleProviderOpenChange}
                    registerClose={registerProviderClose}
                    unregisterClose={unregisterProviderClose}
                    registerOpen={registerRowOpen}
                    unregisterOpen={unregisterRowOpen}
                  />
                ))}

              {/* Then render custom fields (sortable) - with store integration */}
              {sortedCustomFields.map((field: any, idx: number) => (
                <SortablePropertyRow
                  key={field.id}
                  id={field.id}
                  providerId={field.id}
                  field={{ ...field, valueId: fieldValues[field.id]?.valueId }}
                  value={fieldValues[field.id]?.value}
                  mutate={handleFieldMutate(field.id)}
                  loading={isLoadingValues}
                  isEditMode={isEditMode}
                  isSortable={isSortable(field, false)}
                  index={builtInFieldsWithOptions.length + idx}
                  onDelete={handleDeleteField}
                  onEdit={handleEditField}
                  onOpenChange={handleProviderOpenChange}
                  registerClose={registerProviderClose}
                  unregisterClose={unregisterProviderClose}
                  registerOpen={registerRowOpen}
                  unregisterOpen={unregisterRowOpen}
                  storeConfig={storeConfig}
                />
              ))}

              {/* System timestamp fields for entity instances (read-only, non-sortable) */}
              {systemFields.map((field, idx) => (
                <SortablePropertyRow
                  key={`system-${field.id}`}
                  id={`system-${field.id}`}
                  providerId={`system-${field.id}`}
                  field={field}
                  value={field.value ? { type: 'date', value: field.value } : null}
                  mutate={async () => {}}
                  loading={false}
                  isEditMode={isEditMode}
                  isSortable={false}
                  index={builtInFieldsWithOptions.length + sortedCustomFields.length + idx}
                  onOpenChange={handleProviderOpenChange}
                  registerClose={registerProviderClose}
                  unregisterClose={unregisterProviderClose}
                  registerOpen={registerRowOpen}
                  unregisterOpen={unregisterRowOpen}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Add Field row - only show in edit mode */}
          {isEditMode && <AddFieldRow onClick={handleAddField} />}
        </div>
      </div>
    </>
  )
}
