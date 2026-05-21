// apps/web/src/components/chat-widget/ui/settings/featured-articles-field.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useArticleList } from '~/components/kb/hooks/use-article-list'
import { ArticlePicker } from '~/components/kb/ui/articles/article-picker'

interface FeaturedArticlesFieldProps {
  /** KB the picker scopes to; when null the field is disabled. */
  knowledgeBaseId: string | null
  /** Currently-selected article ids, in the visitor-facing order. */
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}

/**
 * Admin control for the chat widget's featured-article list. Renders the
 * selected articles as a draggable list with remove buttons + an "Add article"
 * popover (an `ArticlePicker` scoped to the linked KB).
 */
export function FeaturedArticlesField({
  knowledgeBaseId,
  value,
  onChange,
  disabled,
}: FeaturedArticlesFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const articles = useArticleList(knowledgeBaseId)
  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles])
  const selectedSet = useMemo(() => new Set(value), [value])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = value.indexOf(String(active.id))
    const newIndex = value.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    onChange(arrayMove(value, oldIndex, newIndex))
  }

  const handleRemove = (id: string) => {
    onChange(value.filter((v) => v !== id))
  }

  if (!knowledgeBaseId) {
    return (
      <p className='text-xs text-muted-foreground'>
        Link a knowledge base above to feature articles.
      </p>
    )
  }

  return (
    <div className='space-y-2'>
      {value.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={value} strategy={verticalListSortingStrategy}>
            <ul className='space-y-1.5'>
              {value.map((articleId) => {
                const article = articleById.get(articleId)
                return (
                  <SortableRow
                    key={articleId}
                    id={articleId}
                    title={article?.title ?? 'Untitled'}
                    emoji={article?.emoji ?? null}
                    missing={!article}
                    onRemove={() => handleRemove(articleId)}
                    disabled={disabled}
                  />
                )
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button type='button' variant='outline' size='sm' disabled={disabled}>
            <Plus className='size-3.5' /> Add article
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align='start'
          sideOffset={4}
          className='p-0 w-72'
          onOpenAutoFocus={(e) => e.preventDefault()}>
          <ArticlePicker
            knowledgeBaseId={knowledgeBaseId}
            allowedKinds={['page']}
            forbiddenIds={selectedSet}
            flattenSearch
            rootLabel='Featured articles'
            searchPlaceholder='Search articles…'
            onPick={(articleId) => {
              if (!value.includes(articleId)) onChange([...value, articleId])
              setPickerOpen(false)
            }}
            onClose={() => setPickerOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

interface SortableRowProps {
  id: string
  title: string
  emoji: string | null
  missing: boolean
  onRemove: () => void
  disabled?: boolean
}

function SortableRow({ id, title, emoji, missing, onRemove, disabled }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className='flex items-center gap-2 rounded-md border px-2 py-1.5 bg-background'>
      <button
        type='button'
        className='cursor-grab text-muted-foreground hover:text-foreground touch-none'
        aria-label='Drag to reorder'
        {...attributes}
        {...listeners}>
        <GripVertical className='size-3.5' />
      </button>
      <EntityIcon iconId={emoji ?? 'file-text'} size='xs' className='text-muted-foreground' />
      <span className={`flex-1 truncate text-sm ${missing ? 'italic text-muted-foreground' : ''}`}>
        {missing ? `Missing article (${id.slice(0, 6)}…)` : title}
      </span>
      <Button
        type='button'
        variant='ghost'
        size='icon-xs'
        onClick={onRemove}
        disabled={disabled}
        aria-label='Remove'>
        <X className='size-3.5' />
      </Button>
    </li>
  )
}
