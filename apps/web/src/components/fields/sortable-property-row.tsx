// apps/web/src/components/fields/sortable-property-row.tsx
'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import PropertyRow from './property-row'
import { PropertyProvider, usePropertyContext } from './property-provider'
import { useFieldNavigationOptional } from './field-navigation-context'
import { Button } from '@auxx/ui/components/button'
import { useEffect, useRef, useCallback } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import type { ResourceId } from '@auxx/lib/resources/client'

/**
 * Props for SortablePropertyRow component
 */
interface SortablePropertyRowProps {
  id: string
  providerId: string
  field: any
  value?: any
  loading: boolean
  isEditMode: boolean
  isSortable: boolean
  /** Index in the list for navigation ordering */
  index?: number
  /** Handler for deleting the field (only for custom fields in edit mode) */
  onDelete?: (fieldId: string, fieldName: string) => void
  /** Handler for editing the field (only for custom fields in edit mode) */
  onEdit?: (fieldId: string, field: any) => void
  onOpenChange: (providerId: string, open: boolean) => void
  registerClose: (providerId: string, closeFn: () => void) => void
  unregisterClose: (providerId: string) => void
  /** Register open function for keyboard navigation */
  registerOpen?: (providerId: string, openFn: () => void) => void
  /** Unregister open function when row unmounts */
  unregisterOpen?: (providerId: string) => void
  /** ResourceId in format "entityDefinitionId:entityInstanceId" */
  resourceId: ResourceId
}

/**
 * Wrapper component for PropertyRow that adds sortable DnD functionality
 * In edit mode: shows only drag handle and field name (no values, not clickable)
 * In normal mode: shows full PropertyRow with values and editing capability
 */
export function SortablePropertyRow({
  id,
  providerId,
  field,
  value,
  loading,
  isEditMode,
  isSortable,
  index = 0,
  onDelete,
  onEdit,
  onOpenChange,
  registerClose,
  unregisterClose,
  registerOpen,
  unregisterOpen,
  resourceId,
}: SortablePropertyRowProps) {
  const nav = useFieldNavigationOptional()
  const openFnRef = useRef<(() => void) | null>(null)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !isSortable || !isEditMode,
  })

  // Register this row with the navigation context
  useEffect(() => {
    if (!nav || isEditMode) return
    nav.registerRow(providerId, index)
    return () => nav.unregisterRow(providerId)
  }, [nav, providerId, index, isEditMode])

  // Handler called when PropertyRowWithNavigation gets the open function
  const handleOpenReady = useCallback(
    (openFn: () => void) => {
      if (registerOpen && !isEditMode) {
        registerOpen(providerId, openFn)
      }
    },
    [registerOpen, providerId, isEditMode]
  )

  // Unregister on unmount
  useEffect(() => {
    return () => {
      unregisterOpen?.(providerId)
    }
  }, [unregisterOpen, providerId])

  // Check if this row is focused
  const isFocused = nav?.focusedRowId === providerId

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.8 : 1,
  }

  // Get the original icon for the field
  // let OriginalIcon: LucideIcon | undefined
  // if (field.icon) {
  //   OriginalIcon = field.icon as LucideIcon
  // } else {
  //   OriginalIcon = fieldTypeOptions.find((opt) => opt.value === field.fieldType)?.icon
  // }

  // Value should be TypedFieldValue directly (no legacy { data: x } wrapping)

  // In edit mode with sortable fields: show simplified row with drag handle, name, and delete button
  if (isEditMode && isSortable) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`flex w-full h-fit gap-1 min-h-[30px] items-center ${isDragging ? 'bg-accent rounded' : ''}`}>
        <div
          {...attributes}
          {...listeners}
          className="items-center self-start flex gap-[4px] h-[24px] shrink-0 cursor-grab active:cursor-grabbing">
          <GripVertical className="size-4 text-neutral-400 shrink-0" />
          <div className="w-[120px] text-sm text-neutral-400 shrink-0">
            <div className="truncate">{field.name}</div>
          </div>
        </div>
        {/* Spacer to push action buttons to the right */}
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          {/* Edit button for custom fields */}
          {onEdit && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(field.id, field)}>
              <Pencil />
            </Button>
          )}
          {/* Delete button for custom fields */}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => onDelete(field.id, field.name)}>
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
    )
  }
  // Normal mode: use full PropertyProvider/PropertyRow
  // PropertyProvider uses the global store for bi-directional sync
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-active={isFocused || undefined}
      className={cn('group/row-wrapper', isDragging && 'bg-accent rounded')}>
      <PropertyProvider
        providerId={providerId}
        onOpenChange={onOpenChange}
        registerClose={registerClose}
        unregisterClose={unregisterClose}
        field={field}
        value={value}
        loading={loading}
        resourceId={resourceId}>
        <PropertyRowWithNavigation
          openFnRef={openFnRef}
          onFocus={() => nav?.setFocusedRow(providerId)}
          onOpenReady={handleOpenReady}
        />
      </PropertyProvider>
    </div>
  )
}

/**
 * Wrapper that provides navigation integration to PropertyRow
 */
function PropertyRowWithNavigation({
  openFnRef,
  onFocus,
  onOpenReady,
}: {
  openFnRef: React.MutableRefObject<(() => void) | null>
  onFocus: () => void
  onOpenReady?: (openFn: () => void) => void
}) {
  const { open } = usePropertyContext()

  // Store the open function for external access and notify parent
  useEffect(() => {
    openFnRef.current = open
    onOpenReady?.(open)
  }, [open, openFnRef, onOpenReady])

  return <PropertyRow onFocus={onFocus} />
}
