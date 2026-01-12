// apps/web/src/components/custom-fields/ui/custom-fields-list.tsx
'use client'

import { useState, useEffect } from 'react'
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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { getSmartSortPositions } from '@auxx/utils'

import { TableBody, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { Rows3, Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { useCustomField } from '~/components/custom-fields/hooks/use-custom-field'
import { EmptyState } from '~/components/global/empty-state'
import { CustomFieldRow } from '~/components/custom-fields/ui/field-list'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { useConfirm } from '~/hooks/use-confirm'

/** Props for CustomFieldsList component */
interface CustomFieldsListProps {
  /** Entity definition ID - system resource (e.g. 'contact') or custom entity UUID */
  entityDefinitionId: string | undefined
  /** Resource ID for the current entity (used by relationship field editor) */
  currentResourceId?: string
}

/**
 * FieldList component for displaying a list of custom fields used inside app/settings
 */
export function CustomFieldsList({
  entityDefinitionId,
  currentResourceId,
}: CustomFieldsListProps) {
  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<any | null>(null)

  // Confirm dialog for delete
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()
  // Use sortedFields for local drag order, fallback to API fields
  const { create, update, fields, isLoading, isPending, destroy } = useCustomField({
    entityDefinitionId,
  })
  const [sortedFields, setSortedFields] = useState<any[]>([])

  // Keep sortedFields in sync with API fields unless user is dragging
  useEffect(() => {
    if (fields && fields.length > 0) {
      const sorted = [...fields]
        .filter((f: any) => f.active !== false)
        .sort((a: any, b: any) => (a.sortOrder ?? '').localeCompare(b.sortOrder ?? ''))
      setSortedFields(sorted)
    }
  }, [fields])

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
      // Create new field - modelType is derived from entityDefinitionId on server
      await create.mutateAsync({
        ...fieldData,
        entityDefinitionId,
      })
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
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      let newOrder: { id: string; sortOrder: string }[] = []
      setSortedFields((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id)
        const newIndex = items.findIndex((item) => item.id === over.id)
        const newItems = arrayMove(items, oldIndex, newIndex)
        // Only update affected range using smart sort
        newOrder = getSmartSortPositions(items, oldIndex, newIndex)
        return newItems
      })

      // Update each affected field's sortOrder using generic update mutation
      await Promise.all(newOrder.map(({ id, sortOrder }) => update.mutateAsync({ id, sortOrder })))
    }
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
          currentResourceId={currentResourceId}
        />
      )}

      {isLoading ? (
        <EmptyState
          icon={Rows3}
          iconClassName="animate-spin"
          title="Loading custom fields..."
          description={<div className="max-w-sm">Hold on while we are loading...</div>}
          button={<div className="h-7"></div>}
        />
      ) : sortedFields && sortedFields.length === 0 ? (
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
                <TableHead className="text-right">
                  <Button onClick={handleAddNew} disabled={isPending} variant="outline" size="sm">
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
