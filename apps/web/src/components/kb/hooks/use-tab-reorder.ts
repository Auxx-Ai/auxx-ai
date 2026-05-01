// apps/web/src/components/kb/hooks/use-tab-reorder.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { generateKeyBetween } from '@auxx/utils'
import {
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useCallback, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { type ArticleMeta, getArticleStoreState } from '../store/article-store'
import { useArticleList } from './use-article-list'

interface UseTabReorderResult {
  sensors: ReturnType<typeof useSensors>
  activeTab: ArticleMeta | null
  handleDragStart: (event: DragStartEvent) => void
  handleDragEnd: (event: DragEndEvent) => void
}

/**
 * Drag-and-drop reorder for the horizontal tab strip. Computes the new
 * fractional `sortOrder` client-side so the strip reflows instantly, then
 * sends a single `moveArticle` mutation. Rolls back on error.
 */
export function useTabReorder(knowledgeBaseId: string): UseTabReorderResult {
  const articles = useArticleList(knowledgeBaseId)
  const utils = api.useUtils()
  const moveMutation = api.kb.moveArticle.useMutation()

  const tabs = useMemo(
    () =>
      articles
        .filter((a) => a.articleKind === 'tab')
        .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0)),
    [articles]
  )

  const [activeTab, setActiveTab] = useState<ArticleMeta | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {})
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const tab = tabs.find((t) => t.id === event.active.id)
      if (tab) setActiveTab(tab)
    },
    [tabs]
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTab(null)
      const { active, over } = event
      if (!over || active.id === over.id) return

      const fromIndex = tabs.findIndex((t) => t.id === active.id)
      const toIndex = tabs.findIndex((t) => t.id === over.id)
      if (fromIndex === -1 || toIndex === -1) return

      const moving = tabs[fromIndex]
      const reordered = tabs.filter((_, i) => i !== fromIndex)
      reordered.splice(toIndex, 0, moving)
      const newIndex = toIndex
      const lo = newIndex > 0 ? reordered[newIndex - 1].sortOrder : null
      const hi = newIndex < reordered.length - 1 ? reordered[newIndex + 1].sortOrder : null

      let sortOrder: string
      try {
        sortOrder = generateKeyBetween(lo, hi)
      } catch {
        return
      }

      const adjacentId = tabs[toIndex].id
      const position = toIndex > fromIndex ? 'after' : 'before'

      const store = getArticleStoreState()
      store.applyOptimisticMove({ id: moving.id, parentId: null, sortOrder })
      try {
        await moveMutation.mutateAsync({
          knowledgeBaseId,
          id: moving.id,
          parentId: null,
          adjacentId,
          position,
        })
        store.confirmMove()
        utils.kb.getArticles.invalidate({ knowledgeBaseId })
      } catch (error) {
        store.rollbackMove()
        toastError({
          title: "Couldn't reorder tab",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [tabs, moveMutation, knowledgeBaseId, utils.kb.getArticles]
  )

  return { sensors, activeTab, handleDragStart, handleDragEnd }
}
