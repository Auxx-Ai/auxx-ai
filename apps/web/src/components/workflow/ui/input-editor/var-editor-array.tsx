// apps/web/src/components/workflow/ui/input-editor/var-editor-array.tsx

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
import type React from 'react'
import { useCallback, useMemo } from 'react'
import type { BaseType } from '~/components/workflow/types/unified-types'
import { VarEditor } from '~/components/workflow/ui/input-editor/var-editor'

/**
 * Props for VarEditorArray component
 */
interface VarEditorArrayProps {
  /** Array of string values */
  value: string[]
  /** Callback when values or modes change */
  onChange: (value: string[], modes: boolean[]) => void
  /** Variable type for type-specific inputs */
  varType?: BaseType
  /** Node ID for variable picker context */
  nodeId: string
  /** Disable editing */
  disabled?: boolean
  /** Allow constant mode toggle */
  allowConstant?: boolean
  /** Placeholder for variable mode */
  placeholder?: string
  /** Placeholder for constant mode */
  placeholderConstant?: string
  /** Current constant modes for each item */
  modes?: boolean[]
}

/**
 * Internal representation of an array item
 */
interface ArrayItem {
  id: string
  value: string
  mode: boolean
}

/**
 * Sortable wrapper for each array item
 */
function SortableArrayItem({
  id,
  value,
  mode,
  varType,
  nodeId,
  disabled,
  allowConstant,
  placeholder,
  placeholderConstant,
  showHandle,
  onChange,
  onRemove,
}: {
  id: string
  value: string
  mode: boolean
  varType?: BaseType
  nodeId: string
  disabled?: boolean
  allowConstant?: boolean
  placeholder?: string
  placeholderConstant?: string
  showHandle: boolean
  onChange: (value: string, isConstant: boolean) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('flex items-start gap-1.5 group border-b py-0.5', isDragging && 'opacity-50')}>
      {showHandle && (
        <button
          {...attributes}
          {...listeners}
          className='mt-2 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity'
          disabled={disabled}>
          <GripVertical className='size-3' />
        </button>
      )}

      <div className='flex-1'>
        <VarEditor
          value={value}
          onChange={onChange}
          varType={varType}
          nodeId={nodeId}
          disabled={disabled}
          allowConstant={allowConstant}
          isConstantMode={mode}
          placeholder={placeholder}
          placeholderConstant={placeholderConstant}
        />
      </div>

      <Button
        size='icon-xs'
        variant='destructive-hover'
        onClick={onRemove}
        disabled={disabled}
        className='mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity'>
        <Trash2 />
      </Button>
    </div>
  )
}

/**
 * VarEditorArray - Manages an array of values with VarEditor
 *
 * Features:
 * - Drag-and-drop reordering
 * - Add/remove items
 * - Each item has independent constant mode
 * - Type-specific inputs for all array items
 */
export const VarEditorArray: React.FC<VarEditorArrayProps> = ({
  value,
  onChange,
  varType,
  nodeId,
  disabled = false,
  allowConstant = true,
  placeholder = 'Enter value or use variables',
  placeholderConstant = 'Enter value',
  modes: externalModes,
}) => {
  // Initialize modes array (one per item)
  // biome-ignore lint/correctness/useExhaustiveDependencies: value.map is stable; using value.length as trigger
  const modes = useMemo(() => {
    if (externalModes && externalModes.length === value.length) {
      return externalModes
    }
    // Default: all items start in variable mode
    return value.map(() => false)
  }, [externalModes, value.length])

  // Create items with unique IDs for drag-drop
  const items: ArrayItem[] = useMemo(() => {
    return value.map((val, index) => ({
      id: `item-${index}`,
      value: val,
      mode: modes[index] ?? false,
    }))
  }, [value, modes])

  // Drag-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Handle item reordering
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = items.findIndex((item) => item.id === active.id)
      const newIndex = items.findIndex((item) => item.id === over.id)

      if (oldIndex === -1 || newIndex === -1) return

      const newValue = [...value]
      const newModes = [...modes]

      // Swap items
      const [movedValue] = newValue.splice(oldIndex, 1)
      const [movedMode] = newModes.splice(oldIndex, 1)
      newValue.splice(newIndex, 0, movedValue!)
      newModes.splice(newIndex, 0, movedMode!)

      onChange(newValue, newModes)
    },
    [items, value, modes, onChange]
  )

  // Handle item value change
  const handleItemChange = useCallback(
    (index: number, newValue: string, isConstant: boolean) => {
      const newValues = [...value]
      const newModes = [...modes]
      newValues[index] = newValue
      newModes[index] = isConstant
      onChange(newValues, newModes)
    },
    [value, modes, onChange]
  )

  // Handle item removal
  const handleRemoveItem = useCallback(
    (index: number) => {
      const newValues = value.filter((_, i) => i !== index)
      const newModes = modes.filter((_, i) => i !== index)
      onChange(newValues, newModes)
    },
    [value, modes, onChange]
  )

  // Handle adding new item
  const handleAddItem = useCallback(() => {
    onChange([...value, ''], [...modes, false])
  }, [value, modes, onChange])

  return (
    <div className='space-y-0 flex-1'>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}>
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}>
          {items.map((item, index) => (
            <SortableArrayItem
              key={item.id}
              id={item.id}
              value={item.value}
              mode={item.mode}
              varType={varType}
              nodeId={nodeId}
              disabled={disabled}
              allowConstant={allowConstant}
              placeholder={placeholder}
              placeholderConstant={placeholderConstant}
              showHandle={items.length > 1}
              onChange={(val, isConstant) => handleItemChange(index, val, isConstant)}
              onRemove={() => handleRemoveItem(index)}
            />
          ))}
        </SortableContext>
      </DndContext>

      <Button className='' size='xs' variant='outline' onClick={handleAddItem} disabled={disabled}>
        <Plus />
        Add Item
      </Button>
    </div>
  )
}
