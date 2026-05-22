// apps/web/src/components/chat-widget/ui/settings/featured-articles-field.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { SortableRow } from '~/components/global/sortable-row'
import { useArticleList } from '~/components/kb/hooks/use-article-list'
import { getArticleStoreState } from '~/components/kb/store/article-store'
import { normalizeServerArticle } from '~/components/kb/store/normalize-server-article'
import { ArticlePicker } from '~/components/kb/ui/articles/article-picker'
import { api } from '~/trpc/react'

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

  // The article store is normally hydrated by KnowledgeBaseProvider (mounted only
  // under the KB editor/preview routes). This field renders on the chat widget
  // settings page, so hydrate the store ourselves whenever a KB is linked.
  const articlesQuery = api.kb.getArticles.useQuery(
    { knowledgeBaseId: knowledgeBaseId ?? '', includeUnpublished: true },
    { enabled: !!knowledgeBaseId }
  )
  useEffect(() => {
    if (articlesQuery.data && knowledgeBaseId) {
      getArticleStoreState().setArticles(
        knowledgeBaseId,
        (articlesQuery.data as any[]).map(normalizeServerArticle)
      )
    }
  }, [articlesQuery.data, knowledgeBaseId])

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
      <div className='rounded-xl border bg-popover p-2'>
        {value.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}>
            <SortableContext items={value} strategy={verticalListSortingStrategy}>
              <ul className='space-y-0.5'>
                {value.map((articleId) => {
                  const article = articleById.get(articleId)
                  const title = article?.title ?? `Missing article (${articleId.slice(0, 6)}…)`
                  return (
                    <SortableRow
                      key={articleId}
                      id={articleId}
                      text={title}
                      icon={{ iconId: article?.emoji ?? 'file-text' }}
                      onRemove={() => handleRemove(articleId)}
                      disabled={disabled}
                    />
                  )
                })}
              </ul>
            </SortableContext>
          </DndContext>
        ) : (
          <div className='flex h-8 items-center justify-center text-sm text-muted-foreground'>
            No featured articles yet
          </div>
        )}
      </div>

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
