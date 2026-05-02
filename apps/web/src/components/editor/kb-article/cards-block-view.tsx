// apps/web/src/components/editor/kb-article/cards-block-view.tsx
'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import type { CardData } from '@auxx/ui/components/kb/article'
import { renderMarkdownLite } from '@auxx/ui/components/kb/utils'
import { generateId } from '@auxx/utils'
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
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { CardEditPopover } from './card-edit-popover'
import styles from './cards-block-view.module.css'
import { useKBEditorContext } from './editor-context'

interface CardsBlockViewProps {
  cards: CardData[]
  onChange: (next: CardData[]) => void
  onDeleteBlock: () => void
}

export function CardsBlockView({ cards, onChange, onDeleteBlock }: CardsBlockViewProps) {
  const { knowledgeBaseId } = useKBEditorContext()
  const [editingId, setEditingId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = cards.findIndex((c) => c.id === active.id)
      const newIndex = cards.findIndex((c) => c.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const next = [...cards]
      const [moved] = next.splice(oldIndex, 1)
      next.splice(newIndex, 0, moved)
      onChange(next)
    },
    [cards, onChange]
  )

  const handleAdd = () => {
    onChange([...cards, { id: generateId(), title: 'New card' }])
  }

  const handleDelete = (cardId: string) => {
    const next = cards.filter((c) => c.id !== cardId)
    if (next.length === 0) {
      onDeleteBlock()
      return
    }
    onChange(next)
  }

  const handleUpdate = (cardId: string, patch: Partial<CardData>) => {
    onChange(cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)))
  }

  return (
    <div className={styles.cardsBlock} contentEditable={false}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={cards.map((c) => c.id)} strategy={rectSortingStrategy}>
          <div className={styles.cardsGrid} role='list'>
            {cards.map((card) => (
              <SortableCard
                key={card.id}
                card={card}
                knowledgeBaseId={knowledgeBaseId}
                isEditing={editingId === card.id}
                onOpenChange={(open) => setEditingId(open ? card.id : null)}
                onChange={(patch) => handleUpdate(card.id, patch)}
                onDelete={() => handleDelete(card.id)}
              />
            ))}
            <button type='button' className={styles.addCard} onClick={handleAdd}>
              <Plus size={16} aria-hidden='true' />
              <span>Add card</span>
            </button>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

interface SortableCardProps {
  card: CardData
  knowledgeBaseId?: string
  isEditing: boolean
  onOpenChange: (open: boolean) => void
  onChange: (patch: Partial<CardData>) => void
  onDelete: () => void
}

function SortableCard({
  card,
  knowledgeBaseId,
  isEditing,
  onOpenChange,
  onChange,
  onDelete,
}: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  }

  return (
    <CardEditPopover
      card={card}
      knowledgeBaseId={knowledgeBaseId}
      open={isEditing}
      onOpenChange={onOpenChange}
      onChange={onChange}>
      <div
        ref={setNodeRef}
        style={style}
        className={styles.card}
        data-interactive={card.href ? 'true' : 'false'}
        data-editing={isEditing ? 'true' : undefined}
        role='listitem'
        {...attributes}
        {...listeners}
        onClick={(e) => {
          if (e.defaultPrevented) return
          onOpenChange(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' && !card.title) {
            e.preventDefault()
            onDelete()
          }
        }}>
        <button
          type='button'
          className={styles.cardClose}
          aria-label='Remove card'
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
          }}>
          <X size={12} />
        </button>
        {card.iconId ? (
          <span className={styles.cardIcon}>
            <EntityIcon iconId={card.iconId} variant='bare' size='sm' />
          </span>
        ) : null}
        {card.title ? <span className={styles.cardTitle}>{card.title}</span> : null}
        {card.description ? (
          <span className={styles.cardDescription}>{renderMarkdownLite(card.description)}</span>
        ) : null}
      </div>
    </CardEditPopover>
  )
}
