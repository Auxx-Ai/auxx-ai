// ~/components/global/sidebar/draggable-inbox-list.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { SidebarMenuSubItem } from '@auxx/ui/components/sidebar'
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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
// import { Inbox } from './SharedInboxesGroup'
import { GripVertical } from 'lucide-react'
import React from 'react'

interface DraggableInboxListProps {
  inboxes: Inbox[]
  onReorder: (inboxes: Inbox[]) => void
  onToggleVisibility: (inboxId: string) => void
}

export function DraggableInboxList({
  inboxes,
  onReorder,
  onToggleVisibility,
}: DraggableInboxListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = inboxes.findIndex((item) => item.id === active.id)
      const newIndex = inboxes.findIndex((item) => item.id === over.id)

      const newInboxes = arrayMove(inboxes, oldIndex, newIndex)
      onReorder(newInboxes)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis]}>
      <SortableContext
        items={inboxes.map((inbox) => inbox.id)}
        strategy={verticalListSortingStrategy}>
        {inboxes.map((inbox) => (
          <SortableInboxItem key={inbox.id} inbox={inbox} onToggleVisibility={onToggleVisibility} />
        ))}
      </SortableContext>
    </DndContext>
  )
}

interface SortableInboxItemProps {
  inbox: Inbox
  onToggleVisibility: (inboxId: string) => void
}

function SortableInboxItem({ inbox, onToggleVisibility }: SortableInboxItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: inbox.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <SidebarMenuSubItem ref={setNodeRef} style={style} className={isDragging ? 'z-10' : ''}>
      <div className='flex w-full items-center justify-between px-2 py-1.5'>
        <div className='flex items-center'>
          <div className='mr-2 cursor-move touch-none' {...attributes} {...listeners}>
            <GripVertical className='size-4 text-muted-foreground' />
          </div>
          {inbox.color && (
            <div className='mr-2 size-2 rounded-full' style={{ backgroundColor: inbox.color }} />
          )}
          <span>{inbox.name}</span>
        </div>
        <div className='flex items-center space-x-2'>
          {inbox.unassignedCount ? (
            <Badge variant='secondary'>{inbox.unassignedCount}</Badge>
          ) : null}
          <Checkbox
            checked={inbox.isVisible}
            onCheckedChange={() => onToggleVisibility(inbox.id)}
          />
        </div>
      </div>
    </SidebarMenuSubItem>
  )
}
