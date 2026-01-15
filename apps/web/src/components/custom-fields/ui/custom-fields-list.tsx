// apps/web/src/components/custom-fields/ui/custom-fields-list.tsx
'use client'

import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { generateKeyBetween } from '@auxx/utils'

import { TableBody, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { Rows3, Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { EmptyState } from '~/components/global/empty-state'
import { CustomFieldRow } from '~/components/custom-fields/ui/field-list'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import type { Resource } from '@auxx/lib/resources/client'

/** Props for CustomFieldsList component */
interface CustomFieldsListProps {
  /** Resource (system or custom) */
  resource: Resource
}

/**
 * FieldList component for displaying a list of custom fields used inside app/settings
 */
export function CustomFieldsList({ resource }: CustomFieldsListProps) {
  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<any | null>(null)

  // Confirm dialog for delete
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Get mutations only (fields come from resource)
  const { create, update, isPending, destroy } = useCustomFieldMutations({
    entityDefinitionId: resource.entityDefinitionId,
  })

  // Use resource.fields directly (includes both system and custom fields)
  const sortedFields = [...resource.fields].sort((a, b) =>
    (a.sortOrder ?? '').localeCompare(b.sortOrder ?? '')
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  /** Handle saving a field (create or update) */
  const handleSave = async (fieldData: any) => {
    if (editingField) {
      // Update existing field - include the id
      await update.mutateAsync({ ...fieldData, id: editingField.id })
    } else {
      // entityDefinitionId is now included by CustomFieldDialog
      await create.mutateAsync(fieldData)
    }
    setEditingField(null)
  }

  /** Handle clicking Add Field button */
  const handleAddNew = () => {
    setEditingField(null)
    setDialogOpen(true)
  }

  /** Handle clicking Edit on a field */
  const handleEdit = (field: any) => {
    setEditingField(field)
    setDialogOpen(true)
  }

  /** Handle deleting a field */
  const handleDelete = async (id: string, fieldName?: string) => {
    const confirmed = await confirmDelete({
      title: 'Delete custom field?',
      description: `Are you sure you want to delete "${fieldName || 'this field'}"? This action cannot be undone and any data stored in this field will be lost.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await destroy.mutateAsync({ id })
    }
  }

  /** Handle drag end for reordering */
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = sortedFields.findIndex((item) => item.id === active.id)
    const newIndex = sortedFields.findIndex((item) => item.id === over.id)

    // Calculate new sortOrder using fractional indexing
    // Only the dragged field needs updating
    const prevField = newIndex > 0 ? sortedFields[newIndex - 1] : null
    const nextField = newIndex < sortedFields.length - 1 ? sortedFields[newIndex + 1] : null

    const newSortOrder = generateKeyBetween(
      prevField?.sortOrder ?? null,
      nextField?.sortOrder ?? null
    )

    // Fire optimistic mutation (UI updates immediately via optimistic update hook)
    update.mutate({
      id: active.id as string,
      sortOrder: newSortOrder,
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Confirm Delete Dialog */}
      <ConfirmDeleteDialog />

      {/* Custom Field Dialog for Create/Edit */}
      {dialogOpen && (
        <CustomFieldDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editingField={editingField}
          onSave={handleSave}
          isPending={isPending}
          entityDefinitionId={resource.entityDefinitionId}
          currentResourceId={resource.id}
        />
      )}

      {sortedFields.length === 0 ? (
        <EmptyState
          icon={Rows3}
          title="No custom fields added"
          description={<div className="max-w-sm">Create your first custom field.</div>}
          button={
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddNew}
              loading={isPending}
              loadingText="Saving...">
              <Plus />
              Create Field
            </Button>
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}>
          <table className="text-sm w-full caption-bottom">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[90px]"></TableHead>
                <TableHead className="text-right w-[30px] relative">
                  <Button
                    onClick={handleAddNew}
                    disabled={isPending}
                    variant="outline"
                    size="sm"
                    className="absolute right-0 top-1/2 -translate-y-1/2 right-2">
                    <Plus />
                    <span className="text-foreground">Add</span>
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <SortableContext
                items={sortedFields.map((field) => field.id)}
                strategy={verticalListSortingStrategy}>
                {sortedFields.map((field) => (
                  <CustomFieldRow
                    key={field.id}
                    field={field}
                    onDelete={handleDelete}
                    onEdit={handleEdit}
                    isPending={isPending}
                  />
                ))}
              </SortableContext>
            </TableBody>
          </table>
        </DndContext>
      )}
    </div>
  )
}
