// apps/web/src/components/kb/hooks/use-article-move.tsx
'use client'

import { flattenArticleTreePreservingChildren, getFullSlugPath } from '@auxx/ui/components/kb/utils'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { generateKeyBetween } from '@auxx/utils'
import {
  type CollisionDetection,
  closestCorners,
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
import { type ArticleMeta, getArticleStoreState } from '../store/article-store'
import { useArticleList } from './use-article-list'
import { useArticleTree } from './use-article-tree'

export const DROP_ACTION_TYPE = {
  BEFORE: 'before',
  INSIDE: 'inside',
  CONVERT: 'convert',
  AFTER: 'after',
} as const

export const AFTER_GROUP_SUFFIX = '-after-group'

export type DropActionType = (typeof DROP_ACTION_TYPE)[keyof typeof DROP_ACTION_TYPE]

/**
 * Pure validity check for an article move. Used both as a hover-time gate
 * (via `collisionDetection`) and at drop time (via `computeMove`) so the
 * UI never highlights a target that the move handler would silently reject.
 *
 * `before` and `after` resolve `newParentId` to `target.parentId`; `inside`
 * resolves to `target.id`.
 *
 * Rules:
 *   1. Source exists and is not the target.
 *   2. Tabs are root-only — never moved as children.
 *   3. No drops into the source's own subtree (cycle prevention).
 *   4. Headers must remain direct children of a tab (or KB root).
 */
export function canDropArticle(
  source: ArticleMeta | undefined,
  target: ArticleMeta,
  action: 'before' | 'inside' | 'after',
  articles: ArticleMeta[]
): boolean {
  if (!source) return false
  if (source.id === target.id) return false
  if (source.articleKind === 'tab') return false

  // Cycle check: walk up from the prospective new parent. If we cross the
  // source, the move would put a node inside its own subtree.
  const newParentId = action === 'inside' ? target.id : target.parentId
  let cursor: string | null = newParentId
  while (cursor) {
    if (cursor === source.id) return false
    cursor = articles.find((a) => a.id === cursor)?.parentId ?? null
  }

  if (source.articleKind === 'header') {
    // Headers may sit at KB root (newParentId === null) or directly under a
    // tab. Never inside categories, pages, or other headers.
    const newParent = newParentId ? articles.find((a) => a.id === newParentId) : null
    if (newParent && newParent.articleKind !== 'tab') return false
  }

  return true
}

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

  const moveArticle = api.kb.moveArticle.useMutation()

  const findArticleById = useCallback((id: string) => articles.find((a) => a.id === id), [articles])

  /**
   * Compute the single `{ id, parentId, sortOrder }` update needed to apply
   * a move. Returns null if the move is invalid or impossible.
   */
  const computeMove = useCallback(
    (
      sourceId: string,
      targetId: string,
      action: DropActionType
    ): { id: string; parentId: string | null; sortOrder: string } | null => {
      const source = findArticleById(sourceId)
      const target = findArticleById(targetId)
      if (!source || !target) return null

      const validityAction: 'before' | 'inside' | 'after' =
        action === DROP_ACTION_TYPE.INSIDE || action === DROP_ACTION_TYPE.CONVERT
          ? 'inside'
          : action === DROP_ACTION_TYPE.AFTER
            ? 'after'
            : 'before'
      if (!canDropArticle(source, target, validityAction, articles)) return null

      let parentId: string | null
      let lo: string | null
      let hi: string | null

      if (validityAction === 'inside') {
        parentId = targetId
        const firstChild = articles
          .filter((a) => a.parentId === targetId && a.id !== sourceId)
          .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))[0]
        lo = null
        hi = firstChild?.sortOrder ?? null
      } else {
        parentId = target.parentId
        const siblings = articles
          .filter((a) => a.parentId === parentId && a.id !== sourceId)
          .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
        const idx = siblings.findIndex((s) => s.id === targetId)
        if (idx === -1) return null
        if (validityAction === 'after') {
          lo = siblings[idx]?.sortOrder ?? null
          hi = siblings[idx + 1]?.sortOrder ?? null
        } else {
          lo = siblings[idx - 1]?.sortOrder ?? null
          hi = siblings[idx]?.sortOrder ?? null
        }
      }

      try {
        const sortOrder = generateKeyBetween(lo, hi)
        return { id: sourceId, parentId, sortOrder }
      } catch {
        return null
      }
    },
    [articles, findArticleById]
  )

  /**
   * Drop in a custom collision detector that filters out invalid targets so
   * the existing `over` / `topIsOver` flags on each item naturally short-
   * circuit — no per-item validity gate needed.
   */
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const collisions = closestCorners(args)
      const source = findArticleById(args.active.id.toString())
      if (!source) return collisions

      const beforeSuffix = `-${DROP_ACTION_TYPE.BEFORE}`
      return collisions.filter((c) => {
        const id = c.id.toString()
        const isBefore = id.endsWith(beforeSuffix)
        const isAfterGroup = id.endsWith(AFTER_GROUP_SUFFIX)
        const targetId = isBefore
          ? id.slice(0, -beforeSuffix.length)
          : isAfterGroup
            ? id.slice(0, -AFTER_GROUP_SUFFIX.length)
            : id
        const target = findArticleById(targetId)
        if (!target) return false

        // Mirror handleDragOver: bare-id collisions become INSIDE when the
        // droppable advertises itself as a container (category or header);
        // `-after-group` resolves to AFTER (sibling-after the target at the
        // target's parent level); `-before` is the row's top edge.
        let action: 'before' | 'inside' | 'after' = 'before'
        if (isAfterGroup) {
          action = 'after'
        } else if (!isBefore) {
          const container = (
            c.data?.droppableContainer as
              | {
                  data?: { current?: { isCategory?: boolean; isHeaderContainer?: boolean } }
                }
              | undefined
          )?.data?.current
          if (container?.isCategory === true || container?.isHeaderContainer === true) {
            action = 'inside'
          }
        }

        return canDropArticle(source, target, action, articles)
      })
    },
    [articles, findArticleById]
  )

  const performArticleMovement = useCallback(
    async (sourceId: string, targetId: string, action: DropActionType): Promise<boolean> => {
      if (isMutating) return false
      setIsMutating(true)

      const move = computeMove(sourceId, targetId, action)
      if (!move) {
        setIsMutating(false)
        return false
      }

      const store = getArticleStoreState()
      store.applyOptimisticMove(move)

      try {
        await moveArticle.mutateAsync({ knowledgeBaseId, ...move })
        store.confirmMove()
        utils.kb.getArticles.invalidate({ knowledgeBaseId })
        toastSuccess({
          title: 'Structure Updated',
          description: 'Article organization saved.',
        })
        return true
      } catch (error) {
        store.rollbackMove()
        toastError({
          title: 'Move Failed',
          description: error instanceof Error ? error.message : 'Could not process the move.',
        })
        return false
      } finally {
        setIsMutating(false)
      }
    },
    [computeMove, isMutating, knowledgeBaseId, moveArticle, utils.kb.getArticles]
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
      } else if (overId.endsWith(AFTER_GROUP_SUFFIX)) {
        const targetId = overId.slice(0, -AFTER_GROUP_SUFFIX.length)
        if (activeId !== targetId) {
          newTarget = { id: targetId, action: DROP_ACTION_TYPE.AFTER }
          if (openCategoryTimerRef.current) {
            clearTimeout(openCategoryTimerRef.current)
            openCategoryTimerRef.current = null
            lastHoveredCategoryRef.current = null
          }
        }
      } else if (activeId !== overId && over.data.current?.type) {
        const targetId = overId
        const targetIsCategory = over.data.current?.isCategory === true
        const targetIsHeaderContainer = over.data.current?.isHeaderContainer === true
        const targetIsContainer = targetIsCategory || targetIsHeaderContainer
        // Drop inside containers (categories + headers); pages stay leaves
        // (no auto-promotion).
        const action = targetIsContainer ? DROP_ACTION_TYPE.INSIDE : DROP_ACTION_TYPE.BEFORE
        newTarget = { id: targetId, action }
        // Headers are always rendered open, so don't trigger the auto-open
        // delay — only categories need to expand on hover.
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
        // The store already reflects the new position; update the URL to match
        // via `getFullSlugPath`, which now includes header segments.
        const moved = getArticleStoreState().articles.get(sourceId)
        if (moved) {
          const all = Array.from(getArticleStoreState().articles.values()).filter(
            (a) => a.knowledgeBaseId === knowledgeBaseId
          )
          const slugPath = getFullSlugPath(moved, all)
          router.replace(`/app/kb/${knowledgeBaseId}/editor/~/${slugPath}?panel=articles`)
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
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    dropTarget,
    performArticleMovement,
  }
}

// Re-export tree flatten helper so the panel can use it without an extra import path.
export { flattenArticleTreePreservingChildren }
