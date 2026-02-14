// src/app/(protected)/app/kb/_components/use-article-move.tsx
'use client'

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cloneDeep } from '@auxx/utils/objects'
import {
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { useKnowledgeBase } from './kb-context'

// Action types based on drop detection
export const DROP_ACTION_TYPE = {
  BEFORE: 'before',
  INSIDE: 'inside',
  CONVERT: 'convert',
} as const

export type DropActionType = (typeof DROP_ACTION_TYPE)[keyof typeof DROP_ACTION_TYPE]

export interface ArticleMoveOptions {
  knowledgeBaseId: string
  articleOpenStates: Record<string, boolean>
  setArticleOpenStates: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
}

export function useArticleMove({
  knowledgeBaseId,
  articleOpenStates,
  setArticleOpenStates,
}: ArticleMoveOptions) {
  // --- Hooks ---
  const utils = api.useUtils()
  const router = useRouter()
  const { articles, articleTree } = useKnowledgeBase()

  // --- State ---
  const [isMutating, setIsMutating] = useState(false)
  const [isDraggingAny, setIsDraggingAny] = useState(false)
  const [activeArticle, setActiveArticle] = useState<any | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string
    action: DropActionType
  } | null>(null)
  const [originalArticles, setOriginalArticles] = useState<any[] | null>(null)
  const [optimisticArticles, setOptimisticArticles] = useState<any[] | null>(null)
  // Track categories we've opened during this drag operation
  const openedDuringDragRef = useRef<Set<string>>(new Set())

  // Timer ref for delayed category opening
  const openCategoryTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastHoveredCategoryRef = useRef<string | null>(null)
  // Keep a reference to original article open states before drag started
  const originalOpenStatesRef = useRef<Record<string, boolean>>({})

  // Build article tree from flat array
  const buildArticleTree = useCallback((articles: any[]) => {
    const tree: any[] = []
    const lookup: Record<string, any> = {}

    // Create lookup table
    articles.forEach((article) => {
      const copy = { ...article }
      copy.children = []
      lookup[article.id] = copy
    })

    // Build tree structure
    articles.forEach((article) => {
      if (article.parentId && lookup[article.parentId]) {
        // Add as child
        if (!lookup[article.parentId].children) {
          lookup[article.parentId].children = []
        }
        lookup[article.parentId].children.push(lookup[article.id])
      } else {
        // Add to root
        tree.push(lookup[article.id])
      }
    })

    // Sort each level by the 'order' field if it exists
    // const sortChildren = (items: any[]) => {
    //   // Sort items by order
    //   items.sort((a, b) => (a.order || 0) - (b.order || 0))

    //   // Process children recursively
    //   items.forEach((item) => {
    //     if (item.children && item.children.length > 0) {
    //       sortChildren(item.children)
    //     }
    //   })
    // }

    // // Sort the entire tree
    // sortChildren(tree)

    return tree
  }, [])

  // --- Memoized Values ---
  const currentArticles = useMemo(
    () => optimisticArticles ?? articles ?? [],
    [optimisticArticles, articles]
  )

  const currentArticleTree = useMemo(() => {
    // If we have optimistic articles, build a tree from them, otherwise use the context tree
    return optimisticArticles ? buildArticleTree(optimisticArticles) : articleTree
  }, [optimisticArticles, articleTree, buildArticleTree])

  // Sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {})
  )

  // --- Helper Functions ---

  // Find article by ID
  const findArticleById = useCallback(
    (articleId: string) => {
      return currentArticles.find((a) => a.id === articleId)
    },
    [currentArticles]
  )

  // Flatten tree while preserving children arrays
  const flattenArticleTree = useCallback((tree: any[]) => {
    const result: any[] = []

    const flatten = (nodes: any[]) => {
      nodes.forEach((node) => {
        result.push(node)
        if (node.children && node.children.length > 0) {
          flatten(node.children)
        }
      })
    }

    flatten(tree)
    return result
  }, [])

  // Generate paths for articles in a tree
  const regenerateArticlePaths = useCallback(
    (articles: any[]): any[] => {
      // Build the tree first
      const tree = buildArticleTree(articles)

      // Generate paths for each node
      const generatePaths = (nodes: any[], parentPath = '', parentOrderPath = ''): any[] => {
        return nodes.map((node, index) => {
          // Format index with padding for correct string sorting
          const orderIndex = index.toString().padStart(5, '0')

          // Create paths
          const path = parentPath ? `${parentPath}/${node.id}` : `/${node.id}`
          const orderPath = parentOrderPath ? `${parentOrderPath}/${orderIndex}` : orderIndex

          // Assign to node
          node.path = path
          node.orderPath = orderPath
          node.order = index

          // Process children
          if (node.children && node.children.length > 0) {
            node.children = generatePaths(node.children, path, orderPath)
          }

          return node
        })
      }

      // Generate paths for the entire tree
      const treeWithPaths = generatePaths(tree)

      // Flatten back to array while preserving hierarchies
      return flattenArticleTree(treeWithPaths)
    },
    [buildArticleTree, flattenArticleTree]
  )

  // Compare arrays and identify changed articles
  const identifyChangedArticles = useCallback((oldArticles: any[], newArticles: any[]): any[] => {
    if (!oldArticles || !newArticles) return []

    return newArticles.filter((newArticle) => {
      const oldArticle = oldArticles.find((a) => a.id === newArticle.id)

      // Return true if any relevant property changed
      return (
        !oldArticle ||
        oldArticle.parentId !== newArticle.parentId ||
        oldArticle.orderPath !== newArticle.orderPath ||
        oldArticle.path !== newArticle.path ||
        oldArticle.isCategory !== newArticle.isCategory ||
        oldArticle.order !== newArticle.order
      )
    })
  }, [])

  // --- tRPC Mutation ---
  const updateArticleOrder = api.kb.updateArticleOrder.useMutation({
    onSuccess: () => {
      utils.kb.getArticles.invalidate({ knowledgeBaseId })
      toastSuccess({
        title: 'Structure Updated',
        description: 'Article organization saved.',
      })
      setOriginalArticles(null)
    },
    onError: (error) => {
      toastError({ title: 'Update Failed', description: error.message })
      if (originalArticles) {
        console.error('Rolling back optimistic update due to mutation error.')
        setOptimisticArticles(originalArticles)
        setOriginalArticles(null)
      }
    },
    onSettled: () => {
      setIsMutating(false)
    },
  })

  // --- Main Movement Function ---
  // Consolidated function to handle all article movement operations
  const performArticleMovement = useCallback(
    async (sourceId: string, targetId: string, action: DropActionType): Promise<boolean> => {
      if (isMutating) return false
      console.log(`ARTICLE MOVEMENT: ${sourceId} -> ${targetId} (${action})`)
      setIsMutating(true)

      // Store original articles for potential rollback
      if (!originalArticles) {
        setOriginalArticles(cloneDeep(currentArticles))
      }

      try {
        // Find source and target articles
        const sourceArticle = findArticleById(sourceId)
        const targetArticle = findArticleById(targetId)

        if (!sourceArticle || !targetArticle) {
          throw new Error(`Cannot find article: ${!sourceArticle ? sourceId : targetId}`)
        }

        // Create a tree from the current articles
        const workingTree = buildArticleTree(cloneDeep(currentArticles))

        // Remove source article from its current position in the tree
        const removeSourceFromTree = (nodes: Article[]): Article | null => {
          for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === sourceId) {
              // Found the source, remove it from this array
              return nodes.splice(i, 1)[0]
            }

            // Check children recursively
            if (nodes[i].children && nodes[i].children.length > 0) {
              const found = removeSourceFromTree(nodes[i].children)
              if (found) return found
            }
          }
          return null
        }

        // Remove the source article and get a reference to it
        const removedSource = removeSourceFromTree(workingTree)

        if (!removedSource) {
          throw new Error(`Could not find source article in tree: ${sourceId}`)
        }

        // Clear children array so it doesn't affect placement
        const sourceForInsert = { ...removedSource, children: [] }
        let maxOrder = -1

        // Handle different movement actions
        if (action === DROP_ACTION_TYPE.BEFORE) {
          // Find the target's parent node and insert source before target
          const insertBefore = (nodes: Article[], targetId: string): boolean => {
            for (let i = 0; i < nodes.length; i++) {
              if (nodes[i].id === targetId) {
                // Found target, insert source before it
                sourceForInsert.parentId = nodes[i].parentId
                nodes.splice(i, 0, sourceForInsert)
                return true
              }

              // Check children recursively
              if (nodes[i].children && nodes[i].children.length > 0) {
                if (insertBefore(nodes[i].children, targetId)) return true
              }
            }
            return false
          }

          if (!insertBefore(workingTree, targetId)) {
            throw new Error(`Could not find target article for 'before' placement: ${targetId}`)
          }
        } else if (action === DROP_ACTION_TYPE.INSIDE || action === DROP_ACTION_TYPE.CONVERT) {
          // Find the target node and insert source as a child
          const insertAsChild = (nodes: Article[], targetId: string): boolean => {
            for (let i = 0; i < nodes.length; i++) {
              if (nodes[i].id === targetId) {
                // Found target, make it a category if needed
                if (!nodes[i].isCategory) {
                  nodes[i].isCategory = true
                }

                // Initialize children array if needed
                if (!nodes[i].children) {
                  nodes[i].children = []
                }

                // Find the maximum order among existing children
                maxOrder = nodes[i].children.reduce(
                  (max: number, child: any) => Math.max(max, child.order || 0),
                  -1
                )

                // Add source as a child of target
                sourceForInsert.parentId = targetId
                sourceForInsert.order = maxOrder + 1

                nodes[i].children.unshift(sourceForInsert) // Add at the beginning
                return true
              }

              // Check children recursively
              if (nodes[i].children && nodes[i].children.length > 0) {
                if (insertAsChild(nodes[i].children, targetId)) return true
              }
            }
            return false
          }

          if (!insertAsChild(workingTree, targetId)) {
            throw new Error(
              `Could not find target article for 'inside/convert' placement: ${targetId}`
            )
          }
        }

        // Flatten the tree with path information
        const updatedArticles = regenerateArticlePaths(flattenArticleTree(workingTree))

        // Identify which articles actually changed
        const changedArticles = identifyChangedArticles(currentArticles, updatedArticles)

        // Apply optimistic update
        setOptimisticArticles(updatedArticles)

        // Send only changed articles to backend
        await updateArticleOrder.mutateAsync({
          knowledgeBaseId,
          articles: changedArticles.map((a) => ({
            id: a.id,
            parentId: a.parentId,
            order: a.order,
          })),
        })

        return true
      } catch (error) {
        console.error('Error during article movement:', error)

        // Rollback optimistic update
        if (originalArticles) {
          setOptimisticArticles(originalArticles)
          setOriginalArticles(null)
        }

        setIsMutating(false)

        toastError({
          title: 'Move Failed',
          description:
            error instanceof Error ? error.message : 'Could not process the article movement.',
        })

        return false
      }
    },
    [
      isMutating,
      currentArticles,
      originalArticles,
      findArticleById,
      buildArticleTree,
      flattenArticleTree,
      regenerateArticlePaths,
      identifyChangedArticles,
      knowledgeBaseId,
      updateArticleOrder,
    ]
  )

  // Function to open a category after a delay
  const openCategoryAfterDelay = useCallback(
    (categoryId: string) => {
      // Cancel any pending timer
      if (openCategoryTimerRef.current) {
        clearTimeout(openCategoryTimerRef.current)
        openCategoryTimerRef.current = null
      }

      // Skip if we're already processing this category or it's already open
      if (lastHoveredCategoryRef.current === categoryId || articleOpenStates[categoryId]) {
        return
      }

      // Save the current category ID
      lastHoveredCategoryRef.current = categoryId

      // Set a timer to open the category after a short delay (500ms)
      openCategoryTimerRef.current = setTimeout(() => {
        openedDuringDragRef.current.add(categoryId)
        setArticleOpenStates((prev) => ({ ...prev, [categoryId]: true }))
        openCategoryTimerRef.current = null
      }, 500)
    },
    [articleOpenStates, setArticleOpenStates]
  )

  // --- Drag Handlers ---
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setIsDraggingAny(true)
      const activeId = event.active.id.toString()
      setActiveArticle(currentArticles.find((a) => a.id === activeId) || null)
      setDropTarget(null)
      lastHoveredCategoryRef.current = null
      openedDuringDragRef.current.clear()
      originalOpenStatesRef.current = { ...articleOpenStates }

      // Cancel any pending category open timer
      if (openCategoryTimerRef.current) {
        clearTimeout(openCategoryTimerRef.current)
        openCategoryTimerRef.current = null
      }
    },
    [currentArticles, articleOpenStates]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event
      if (!over) {
        if (dropTarget) setDropTarget(null)

        // Cancel any pending category open timer
        if (openCategoryTimerRef.current) {
          clearTimeout(openCategoryTimerRef.current)
          openCategoryTimerRef.current = null
          lastHoveredCategoryRef.current = null
        }
        return
      }

      const activeId = active.id.toString()
      const overId = over.id.toString()
      let newTarget: { id: string; action: DropActionType } | null = null

      const beforeSuffix = `-${DROP_ACTION_TYPE.BEFORE}`
      if (overId.endsWith(beforeSuffix)) {
        const targetId = overId.substring(0, overId.length - beforeSuffix.length)
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
        const action = targetIsCategory ? DROP_ACTION_TYPE.INSIDE : DROP_ACTION_TYPE.CONVERT
        newTarget = { id: targetId, action: action }

        // Only try to open a category if this is going inside it
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
          // Cancel timer if no longer hovering over a valid category for opening
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
    [dropTarget, articleOpenStates, openCategoryAfterDelay]
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setIsDraggingAny(false)
      const finalTargetAction = dropTarget
      setDropTarget(null)
      setActiveArticle(null)

      // Clear any pending timers and state
      if (openCategoryTimerRef.current) {
        clearTimeout(openCategoryTimerRef.current)
        openCategoryTimerRef.current = null
      }
      lastHoveredCategoryRef.current = null

      const { active, over } = event
      if (!over || !finalTargetAction || active.id === finalTargetAction.id) {
        console.log('DragEnd: No action needed')
        // If we didn't complete a valid drop, reset any categories that were opened during drag
        if (openedDuringDragRef.current.size > 0) {
          setArticleOpenStates((prev) => {
            const newState = { ...prev }
            // Close only the categories we opened during this drag session
            openedDuringDragRef.current.forEach((id) => {
              // Only close them if they were originally closed
              if (!originalOpenStatesRef.current[id]) {
                newState[id] = false
              }
            })
            return newState
          })
        }

        // Reset tracked opened categories
        openedDuringDragRef.current.clear()
        if (originalArticles) {
          setOptimisticArticles(originalArticles)
          setOriginalArticles(null)
        }
        return
      }

      const sourceId = active.id.toString()
      const { id: targetId, action } = finalTargetAction
      const success = await performArticleMovement(sourceId, targetId, action)
      // We keep folders open on successful drops, but close them on failure
      if (!success && openedDuringDragRef.current.size > 0) {
        setArticleOpenStates((prev) => {
          const newState = { ...prev }
          openedDuringDragRef.current.forEach((id) => {
            if (!originalOpenStatesRef.current[id]) {
              newState[id] = false
            }
          })
          return newState
        })
      }

      // Reset tracking state
      openedDuringDragRef.current.clear()

      // Use our consolidated movement function
      if (success) {
        // Find the updated article in our optimistic state
        const movedArticle = optimisticArticles?.find((a) => a.id === sourceId)

        if (movedArticle) {
          // Update the URL to match the article's new location
          const { getFullSlugPath } = useKnowledgeBase()
          const newPath = getFullSlugPath(movedArticle, false) // Don't include query params

          // Use router.replace to avoid adding to history
          router.replace(newPath)

          toastSuccess({
            title: 'Article Moved',
            description: 'The article has been successfully relocated.',
          })
        }
      }
    },
    [
      dropTarget,
      originalArticles,
      performArticleMovement,
      optimisticArticles,
      router,
      setArticleOpenStates,
    ]
  )

  // --- Cleanup Effect ---
  useEffect(() => {
    return () => {
      // Clear any timers on unmount
      if (openCategoryTimerRef.current) {
        clearTimeout(openCategoryTimerRef.current)
      }
      openedDuringDragRef.current.clear()
      setOriginalArticles(null)
      setOptimisticArticles(null)
    }
  }, [])

  // --- Returned Hook API ---
  return {
    isMutating,
    isDraggingAny,
    activeArticle,
    articleTree: currentArticleTree,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    dropTarget,
    performArticleMovement, // Expose the movement function for direct calls
  }
}
