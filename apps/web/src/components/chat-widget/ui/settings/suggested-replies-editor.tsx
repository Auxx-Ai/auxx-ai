// apps/web/src/components/chat-widget/ui/settings/suggested-replies-editor.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SortableRow } from '~/components/global/sortable-row'

const MAX_REPLIES = 5
const MAX_LABEL_LENGTH = 80

interface SuggestedRepliesEditorProps {
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}

interface Row {
  id: string
  text: string
}

/**
 * Editor for the chat widget's suggested-reply chips. Renders one input per
 * chip with drag-to-reorder + remove, plus an "Add suggestion" button capped
 * at `MAX_REPLIES`. Blank rows are kept editable mid-flow and only filtered
 * out when the parent form submits.
 */
export function SuggestedRepliesEditor({ value, onChange, disabled }: SuggestedRepliesEditorProps) {
  // Local row state with stable ids so drag reorder + per-row keys stay
  // identity-stable even while a row's text is empty during editing.
  const idCounter = useRef(0)
  const nextId = () => {
    idCounter.current += 1
    return `r${idCounter.current}`
  }

  const [rows, setRows] = useState<Row[]>(() => value.map((text) => ({ id: nextId(), text })))

  // Re-sync from outside when `value` changes by an external reset (form.reset()).
  // Local edits push down via onChange, so a mismatch here means the parent
  // form replaced the array — re-seed local rows with fresh ids.
  const valueKey = JSON.stringify(value)
  const rowsKey = JSON.stringify(rows.map((r) => r.text))
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional sync only on external value change
  useEffect(() => {
    if (valueKey !== rowsKey) {
      setRows(value.map((text) => ({ id: nextId(), text })))
    }
  }, [valueKey])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const ids = useMemo(() => rows.map((r) => r.id), [rows])

  const push = (next: Row[]) => {
    setRows(next)
    onChange(next.map((r) => r.text))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    push(arrayMove(rows, oldIndex, newIndex))
  }

  const handleChangeRow = (id: string, text: string) => {
    push(rows.map((r) => (r.id === id ? { ...r, text } : r)))
  }

  const handleRemove = (id: string) => {
    push(rows.filter((r) => r.id !== id))
  }

  const handleAdd = () => {
    if (rows.length >= MAX_REPLIES) return
    push([...rows, { id: nextId(), text: '' }])
  }

  return (
    <div className='space-y-2'>
      <div className='rounded-xl border bg-popover p-2'>
        {rows.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className='space-y-0.5'>
                {rows.map((row) => (
                  <SortableRow
                    key={row.id}
                    id={row.id}
                    text={row.text}
                    placeholder='Product question'
                    maxLength={MAX_LABEL_LENGTH}
                    disabled={disabled}
                    onChange={(text) => handleChangeRow(row.id, text)}
                    onRemove={() => handleRemove(row.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : (
          <div className='flex h-8 items-center justify-center text-sm text-muted-foreground'>
            No suggestions yet
          </div>
        )}
      </div>
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={handleAdd}
        disabled={disabled || rows.length >= MAX_REPLIES}>
        <Plus /> Add suggestion
      </Button>

      <p className='text-xs text-muted-foreground'>
        Up to {MAX_REPLIES} suggestions. Tapping a chip sends its label as the visitor's first
        message.
      </p>
    </div>
  )
}
