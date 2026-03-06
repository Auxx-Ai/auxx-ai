// apps/web/src/lib/extensions/components/workflow/inputs/array-input-internal.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import React, { useCallback, useMemo } from 'react'
import {
  AppWorkflowFieldContext,
  useAppWorkflowFieldContext,
} from '~/lib/workflow/components/app-workflow-field-context'

// ── ArrayItemContext ──────────────────────────────────────────────────────

interface ArrayItemContextValue {
  index: number
  isFirst: boolean
  isLast: boolean
  total: number
  remove: () => void
}

const ArrayItemContext = React.createContext<ArrayItemContextValue | null>(null)

export { ArrayItemContext }
export type { ArrayItemContextValue }

// ── SortableArrayItem ─────────────────────────────────────────────────────

function SortableArrayItem({
  id,
  itemCount,
  minItems,
  canReorder,
  disabled,
  onRemove,
  children,
}: {
  id: string
  itemCount: number
  minItems: number
  canReorder: boolean
  disabled?: boolean
  onRemove: () => void
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canReorder || disabled,
  })

  const style = canReorder
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined

  return (
    <div
      ref={canReorder ? setNodeRef : undefined}
      style={style}
      className={cn('flex items-start gap-1.5 group border-b py-1', isDragging && 'opacity-50')}>
      {canReorder && itemCount > 1 && (
        <button
          type='button'
          {...attributes}
          {...listeners}
          className='mt-2 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity'
          disabled={disabled}>
          <GripVertical className='size-3' />
        </button>
      )}

      <div className='flex-1'>{children}</div>

      <Button
        size='icon-xs'
        variant='destructive-hover'
        onClick={onRemove}
        disabled={itemCount <= minItems}
        className='mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity'>
        <Trash2 />
      </Button>
    </div>
  )
}

// ── ArrayInputInternal ────────────────────────────────────────────────────

interface ArrayInputInternalProps {
  name: string
  label?: string
  minItems?: number
  maxItems?: number
  addLabel?: string
  addPosition?: 'top' | 'bottom'
  canReorder?: boolean
  children?: React.ReactNode
}

export const ArrayInputInternal: React.FC<ArrayInputInternalProps> = ({
  name,
  minItems = 0,
  maxItems,
  addLabel = 'Add Item',
  addPosition = 'bottom',
  canReorder = false,
  children,
}) => {
  const parentCtx = useAppWorkflowFieldContext()
  const { nodeData, getFieldMode, schema, nodeId, isTrigger } = parentCtx

  // Read array data
  const items: any[] = useMemo(() => {
    const raw = nodeData[name]
    return Array.isArray(raw) ? raw : []
  }, [nodeData, name])

  // Stable item IDs for drag-drop (index-based, regenerated when array changes)
  const itemIds = useMemo(() => items.map((_, i) => `${name}-${i}`), [items, name])

  // Read struct schema for scoped context
  const structFields = useMemo(() => {
    const arraySchema = schema?.inputs?.[name]
    if (arraySchema?.items?.fields) {
      return arraySchema.items.fields
    }
    return null
  }, [schema, name])

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // ── Array operations ────────────────────────────────────────────────

  const updateArray = useCallback(
    (newItems: any[], fieldModesUpdates?: Record<string, boolean>) => {
      if (parentCtx.setInputs) {
        parentCtx.setInputs({
          ...nodeData,
          [name]: newItems,
          fieldModes: {
            ...(nodeData.fieldModes || {}),
            ...fieldModesUpdates,
          },
        })
      } else {
        parentCtx.handleFieldChange(name, newItems, true)
      }
    },
    [parentCtx, nodeData, name]
  )

  const handleAdd = useCallback(() => {
    if (maxItems !== undefined && items.length >= maxItems) return

    // Build default item from struct schema
    const defaultItem: Record<string, any> = {}
    if (structFields) {
      for (const [key, field] of Object.entries(structFields as Record<string, any>)) {
        defaultItem[key] = field?.default ?? ''
      }
    }

    updateArray([...items, defaultItem])
  }, [items, maxItems, structFields, updateArray])

  const handleRemove = useCallback(
    (index: number) => {
      if (items.length <= minItems) return
      const newItems = items.filter((_, i) => i !== index)
      updateArray(newItems)
    },
    [items, minItems, updateArray]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = itemIds.indexOf(active.id as string)
      const newIndex = itemIds.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) return

      const newItems = [...items]
      const [moved] = newItems.splice(oldIndex, 1)
      newItems.splice(newIndex, 0, moved!)

      updateArray(newItems)
    },
    [items, itemIds, updateArray]
  )

  // ── Scoped context factory ──────────────────────────────────────────

  const createScopedContext = useCallback(
    (index: number) => {
      const itemData = items[index] ?? {}

      const scopedHandleFieldChange = (fieldKey: string, value: any, isConstantMode: boolean) => {
        const currentArray = Array.isArray(nodeData[name]) ? [...nodeData[name]] : []
        currentArray[index] = { ...currentArray[index], [fieldKey]: value }

        const scopedModeKey = `${name}[${index}].${fieldKey}`

        if (parentCtx.setInputs) {
          parentCtx.setInputs({
            ...nodeData,
            [name]: currentArray,
            fieldModes: {
              ...(nodeData.fieldModes || {}),
              [scopedModeKey]: isConstantMode,
            },
          })
        } else {
          parentCtx.handleFieldChange(name, currentArray, true)
        }
      }

      const scopedGetFieldMode = (fieldKey: string): boolean => {
        const scopedKey = `${name}[${index}].${fieldKey}`
        return getFieldMode(scopedKey)
      }

      const scopedSchema = structFields ? { inputs: structFields } : schema

      return {
        nodeId,
        nodeData: itemData,
        handleFieldChange: scopedHandleFieldChange,
        getFieldMode: scopedGetFieldMode,
        schema: scopedSchema,
        isTrigger,
      }
    },
    [items, name, nodeData, parentCtx, getFieldMode, structFields, schema, nodeId, isTrigger]
  )

  // ── Render ──────────────────────────────────────────────────────────

  const addButton = (
    <Button
      size='xs'
      variant='outline'
      onClick={handleAdd}
      disabled={maxItems !== undefined && items.length >= maxItems}>
      <Plus />
      {addLabel}
    </Button>
  )

  const itemList = items.map((_, index) => {
    const scopedCtx = createScopedContext(index)
    const arrayItemValue: ArrayItemContextValue = {
      index,
      isFirst: index === 0,
      isLast: index === items.length - 1,
      total: items.length,
      remove: () => handleRemove(index),
    }

    return (
      <SortableArrayItem
        key={itemIds[index]}
        id={itemIds[index]!}
        itemCount={items.length}
        minItems={minItems}
        canReorder={canReorder}
        onRemove={() => handleRemove(index)}>
        <ArrayItemContext.Provider value={arrayItemValue}>
          <AppWorkflowFieldContext.Provider value={scopedCtx}>
            {children}
          </AppWorkflowFieldContext.Provider>
        </ArrayItemContext.Provider>
      </SortableArrayItem>
    )
  })

  const wrappedItemList = canReorder ? (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis]}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {itemList}
      </SortableContext>
    </DndContext>
  ) : (
    <>{itemList}</>
  )

  return (
    <div className='space-y-0 flex-1'>
      {addPosition === 'top' && addButton}
      {wrappedItemList}
      {addPosition === 'bottom' && addButton}
    </div>
  )
}
