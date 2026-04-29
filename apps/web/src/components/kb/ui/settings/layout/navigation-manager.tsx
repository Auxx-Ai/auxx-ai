// apps/web/src/components/kb/ui/settings/layout/navigation-manager.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
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
import { GripVertical, PlusCircle, Trash2 } from 'lucide-react'

interface SortableItemProps {
  id: string
  item: { title: string; link: string }
  onRemove: () => void
  onChange: (field: 'title' | 'link', value: string) => void
  disabled: boolean
}

function SortableItem({ id, item, onRemove, onChange, disabled }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className='mb-2 flex items-center space-x-2 rounded-md border bg-background p-2'>
      <div {...attributes} {...listeners} className='cursor-grab'>
        <GripVertical className='h-5 w-5 text-muted-foreground' />
      </div>
      <div className='grid flex-1 grid-cols-2 gap-2'>
        <Input
          value={item.title}
          onChange={(e) => onChange('title', e.target.value)}
          placeholder='Menu title'
          className='w-full'
          disabled={disabled}
        />
        <Input
          value={item.link}
          onChange={(e) => onChange('link', e.target.value)}
          placeholder='/url-path or https://...'
          className='w-full'
          disabled={disabled}
        />
      </div>
      <Button type='button' variant='ghost' size='icon' onClick={onRemove} disabled={disabled}>
        <Trash2 className='h-4 w-4 text-destructive' />
      </Button>
    </div>
  )
}

interface NavigationManagerProps {
  type: 'header' | 'footer'
  value: Array<{ title: string; link: string }>
  onChange: (items: Array<{ title: string; link: string }>) => void
  disabled: boolean
}

export function NavigationManager({ type, value, onChange, disabled }: NavigationManagerProps) {
  const items = value || []
  const itemIds = items.map((_, index) => `${type}-item-${index}`)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = itemIds.indexOf(active.id as string)
      const newIndex = itemIds.indexOf(over.id as string)
      const next = [...items]
      const [moved] = next.splice(oldIndex, 1)
      next.splice(newIndex, 0, moved)
      onChange(next)
    }
  }

  const handleAdd = () => onChange([...items, { title: '', link: '' }])
  const handleRemove = (index: number) => {
    const next = [...items]
    next.splice(index, 1)
    onChange(next)
  }
  const handleItemChange = (index: number, field: 'title' | 'link', value: string) => {
    const next = [...items]
    next[index] = { ...next[index], [field]: value }
    onChange(next)
  }

  return (
    <div className='space-y-4'>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className='space-y-2'>
            {items.map((item, index) => (
              <SortableItem
                key={itemIds[index]}
                id={itemIds[index]}
                item={item}
                onRemove={() => handleRemove(index)}
                onChange={(field, value) => handleItemChange(index, field, value)}
                disabled={disabled}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={handleAdd}
        disabled={disabled}
        className='w-full'>
        <PlusCircle className='mr-2 h-4 w-4' />
        Add Navigation Item
      </Button>
    </div>
  )
}
