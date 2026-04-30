// apps/web/src/components/kb/hooks/use-article-move.tsx
'use client'

import {
  buildArticleTree,
  flattenArticleTreePreservingChildren,
} from '@auxx/ui/components/kb/utils'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import {
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useRouter } from 'next/navigation'
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import {
  type ArticleMeta,
  type ArticleTreeNode,
  getArticleStoreState,
} from '../store/article-store'
import { useArticleList } from './use-article-list'
import { useArticleTree } from './use-article-tree'

export const DROP_ACTION_TYPE = {
  BEFORE: 'before',
  INSIDE: 'inside',
  CONVERT: 'convert',
} as const

export type DropActionType = (typeof DROP_ACTION_TYPE)[keyof typeof DROP_ACTION_TYPE]

interface UseArticleMoveOptions {
  knowledgeBaseId: string
  articleOpenStates: Record<string, boolean>
  setArticleOpenStates: Dispatch<SetStateAction<Record<string, boolean>>>
}

interface DropTarget {
  id: string
  action: DropActionType
}

export function useArticleMove({
  knowledgeBaseId,
  articleOpenStates,
  setArticleOpenStates,
}: UseArticleMoveOptions) {
  const utils = api.useUtils()
  const router = useRouter()
  const articles = useArticleList(knowledgeBaseId)
  const articleTree = useArticleTree(knowledgeBaseId)

  const [isMutating, setIsMutating] = useState(false)
  const [isDraggingAny, setIsDraggingAny] = useState(false)
  const [activeArticle, setActiveArticle] = useState<ArticleMeta | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  // Tracks categories we auto-opened during the drag so we can re-collapse on cancel/error.
  const openedDuringDragRef = useRef<Set<string>>(new Set())
  const openCategoryTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastHoveredCategoryRef = useRef<string | null>(null)
  const originalOpenStatesRef = useRef<Record<string, boolean>>({})

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, {})
  )

  const updateArticleOrder = api.kb.updateArticleOrder.useMutation()

  const findArticleById = useCallback((id: string) => articles.find((a) => a.id === id), [articles])

  /**
   * Compute the full set of `{ id, parentId, order }` updates after applying
   * a move. Only changed articles are returned.
   */
  const computeReorderUpdates = useCallback(
    (
      sourceId: string,
      targetId: string,
      action: DropActionType
    ): Array<{ id: string; parentId: string | null; order: number }> | null => {
      const source = findArticleById(sourceId)
      const target = findArticleById(targetId)
      if (!source || !target) return null

      // Article-kind constraints: tabs are root-only; everything else lives
      // under a tab; headers cannot nest under another header.
      if (source.articleKind === 'tab') return null
      if (target.articleKind === 'header' && source.articleKind === 'header') return null

      // Build a deep-cloned working tree we can mutate.
      const workingTree = buildArticleTree(articles.map((a) => ({ ...a }))) as ArticleTreeNode[]

      const removeFromTree = (nodes: ArticleTreeNode[]): ArticleTreeNode | null => {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === sourceId) {
            return nodes.splice(i, 1)[0]
          }
          if (nodes[i].children?.length) {
            const found = removeFromTree(nodes[i].children)
            if (found) return found
          }
        }
        return null
      }

      const removed = removeFromTree(workingTree)
      if (!removed) return null
      const sourceForInsert: ArticleTreeNode = { ...removed, children: [] }

      if (action === DROP_ACTION_TYPE.BEFORE) {
        const insertBefore = (nodes: ArticleTreeNode[]): boolean => {
          for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === targetId) {
              sourceForInsert.parentId = nodes[i].parentId
              nodes.splice(i, 0, sourceForInsert)
              return true
            }
            if (nodes[i].children?.length) {
              if (insertBefore(nodes[i].children)) return true
            }
          }
          return false
        }
        if (!insertBefore(workingTree)) return null
      } else if (action === DROP_ACTION_TYPE.INSIDE || action === DROP_ACTION_TYPE.CONVERT) {
        const insertAsChild = (nodes: ArticleTreeNode[]): boolean => {
          for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === targetId) {
              if (!nodes[i].children) nodes[i].children = []
              sourceForInsert.parentId = targetId
              nodes[i].children.unshift(sourceForInsert)
              return true
            }
            if (nodes[i].children?.length) {
              if (insertAsChild(nodes[i].children)) return true
            }
          }
          return false
        }
        if (!insertAsChild(workingTree)) return null
      }

      // Walk the tree and assign new (parentId, order). Only return changed entries.
      const updates: Array<{ id: string; parentId: string | null; order: number }> = []
      const walk = (nodes: ArticleTreeNode[], parentId: string | null) => {
        nodes.forEach((node, index) => {
          const existing = articles.find((a) => a.id === node.id)
          if (!existing || existing.parentId !== parentId || existing.order !== index) {
            updates.push({ id: node.id, parentId, order: index })
          }
          if (node.children?.length) walk(node.children, node.id)
        })
      }
      walk(workingTree, null)
      return updates
    },
    [articles, findArticleById]
  )

  const performArticleMovement = useCallback(
    async (sourceId: string, targetId: string, action: DropActionType): Promise<boolean> => {
      if (isMutating) return false
      setIsMutating(true)

      const updates = computeReorderUpdates(sourceId, targetId, action)
      if (!updates || updates.length === 0) {
        setIsMutating(false)
        return false
      }

      const store = getArticleStoreState()
      store.applyOptimisticReorder(updates)

      try {
        await updateArticleOrder.mutateAsync({ knowledgeBaseId, articles: updates })
        store.confirmReorder()
        utils.kb.getArticles.invalidate({ knowledgeBaseId })
        toastSuccess({
          title: 'Structure Updated',
          description: 'Article organization saved.',
        })
        return true
      } catch (error) {
        store.rollbackReorder()
        toastError({
          title: 'Move Failed',
          description: error instanceof Error ? error.message : 'Could not process the move.',
        })
        return false
      } finally {
        setIsMutating(false)
      }
    },
    [computeReorderUpdates, isMutating, knowledgeBaseId, updateArticleOrder, utils.kb.getArticles]
  )

  const openCategoryAfterDelay = useCallback(
    (categoryId: string) => {
      if (openCategoryTimerRef.current) {
        clearTimeout(openCategoryTimerRef.current)
        openCategoryTimerRef.current = null
      }
      if (lastHoveredCategoryRef.current === categoryId || articleOpenStates[categoryId]) {
        return
      }
      lastHoveredCategoryRef.current = categoryId
      openCategoryTimerRef.current = setTimeout(() => {
        openedDuringDragRef.current.add(categoryId)
        setArticleOpenStates((prev) => ({ ...prev, [categoryId]: true }))
        openCategoryTimerRef.current = null
      }, 500)
    },
    [articleOpenStates, setArticleOpenStates]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setIsDraggingAny(true)
      const activeId = event.active.id.toString()
      setActiveArticle(findArticleById(activeId) ?? null)
      setDropTarget(null)
      lastHoveredCategoryRef.current = null
      openedDuringDragRef.current.clear()
      originalOpenStatesRef.current = { ...articleOpenStates }
      if (openCategoryTimerRef.current) {
        clearTimeout(openCategoryTimerRef.current)
        openCategoryTimerRef.current = null
      }
    },
    [articleOpenStates, findArticleById]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event
      if (!over) {
        if (dropTarget) setDropTarget(null)
        if (openCategoryTimerRef.current) {
          clearTimeout(openCategoryTimerRef.current)
          openCategoryTimerRef.current = null
          lastHoveredCategoryRef.current = null
        }
        return
      }

      const activeId = active.id.toString()
      const overId = over.id.toString()
      let newTarget: DropTarget | null = null

      const beforeSuffix = `-${DROP_ACTION_TYPE.BEFORE}`
      if (overId.endsWith(beforeSuffix)) {
        const targetId = overId.slice(0, -beforeSuffix.length)
        if (activeId !== targetId) {
          newTarget = { id: targetId, action: DROP_ACTION_TYPE.BEFORE }
          if (openCategoryTimerRef.current) {
            clearTimeout(openCategoryTimerRef.current)
            openCategoryTimerRef.current = null
            lastHoveredCategoryRef.current = null
          }
        }
      } else if (activeId !== overId && over.data.current?.type) {
        const targetId = overId
        const targetIsCategory = over.data.current?.isCategory === true
        // Drop inside categories; pages stay leaves (no auto-promotion).
        const action = targetIsCategory ? DROP_ACTION_TYPE.INSIDE : DROP_ACTION_TYPE.BEFORE
        newTarget = { id: targetId, action }
        if (
          targetIsCategory &&
          action === DROP_ACTION_TYPE.INSIDE &&
          !articleOpenStates[targetId]
        ) {
          openCategoryAfterDelay(targetId)
        } else if (
          !targetIsCategory ||
          action !== DROP_ACTION_TYPE.INSIDE ||
          lastHoveredCategoryRef.current !== targetId
        ) {
          if (openCategoryTimerRef.current) {
            clearTimeout(openCategoryTimerRef.current)
            openCategoryTimerRef.current = null
            lastHoveredCategoryRef.current = null
          }
        }
      }

      if (dropTarget?.id !== newTarget?.id || dropTarget?.action !== newTarget?.action) {
        setDropTarget(newTarget)
      }
    },
    [articleOpenStates, dropTarget, openCategoryAfterDelay]
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setIsDraggingAny(false)
      const finalTarget = dropTarget
      setDropTarget(null)
      setActiveArticle(null)

      if (openCategoryTimerRef.current) {
        clearTimeout(openCategoryTimerRef.current)
        openCategoryTimerRef.current = null
      }
      lastHoveredCategoryRef.current = null

      const { active, over } = event
      if (!over || !finalTarget || active.id === finalTarget.id) {
        // Cancelled or invalid drop — re-collapse anything we auto-opened.
        if (openedDuringDragRef.current.size > 0) {
          setArticleOpenStates((prev) => {
            const next = { ...prev }
            openedDuringDragRef.current.forEach((id) => {
              if (!originalOpenStatesRef.current[id]) next[id] = false
            })
            return next
          })
        }
        openedDuringDragRef.current.clear()
        return
      }

      const sourceId = active.id.toString()
      const success = await performArticleMovement(sourceId, finalTarget.id, finalTarget.action)
      if (!success && openedDuringDragRef.current.size > 0) {
        setArticleOpenStates((prev) => {
          const next = { ...prev }
          openedDuringDragRef.current.forEach((id) => {
            if (!originalOpenStatesRef.current[id]) next[id] = false
          })
          return next
        })
      }
      openedDuringDragRef.current.clear()

      if (success) {
        // The store already reflects the new position; update the URL to match.
        const moved = getArticleStoreState().articles.get(sourceId)
        if (moved) {
          // Build full slug path from the updated store state.
          const all = Array.from(getArticleStoreState().articles.values()).filter(
            (a) => a.knowledgeBaseId === knowledgeBaseId
          )
          const slugs: string[] = [moved.slug]
          let cursor = moved.parentId
          while (cursor) {
            const parent = all.find((a) => a.id === cursor)
            if (!parent) break
            slugs.unshift(parent.slug)
            cursor = parent.parentId
          }
          router.replace(`/app/kb/${knowledgeBaseId}/editor/~/${slugs.join('/')}?panel=articles`)
        }
      }
    },
    [dropTarget, knowledgeBaseId, performArticleMovement, router, setArticleOpenStates]
  )

  useEffect(() => {
    return () => {
      if (openCategoryTimerRef.current) clearTimeout(openCategoryTimerRef.current)
      openedDuringDragRef.current.clear()
    }
  }, [])

  return {
    isMutating,
    isDraggingAny,
    activeArticle,
    articleTree,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    dropTarget,
    performArticleMovement,
  }
}

// Re-export tree flatten helper so the panel can use it without an extra import path.
export { flattenArticleTreePreservingChildren }
