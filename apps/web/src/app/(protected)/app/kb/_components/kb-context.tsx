// src/app/(protected)/app/kb/_components/kb-context.tsx
'use client'

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { usePathname, useRouter } from 'next/navigation'
import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { api } from '~/trpc/react'
import {
  buildArticleTree,
  findArticleAndParent,
  flattenArticleTreePreservingChildren,
  generateArticlePaths,
  getFullSlugPath,
  isArticleActive,
} from './helpers'

// Enhanced Article type with path information
interface Article {
  id: string
  title: string
  slug: string
  emoji?: string | null
  parentId: string | null
  isCategory: boolean
  order: number
  isPublished: boolean
  description?: string | null
  content?: string | null
  children?: Article[]
  // Added path properties
  path?: string // Materialized path (e.g., "/root/parent/child")
  orderPath?: string // Numeric path (e.g., "1/3/2") for sorting
}

interface KnowledgeBaseContextProps {
  articles: Article[]
  articleTree: Article[]
  getCurrentArticle: (articleId: string) => Article | undefined
  getPrevArticle: (article: Article) => Article | undefined
  getNextArticle: (article: Article) => Article | undefined
  getFullSlugPath: (article: Article, includeQuery?: boolean) => string
  getRelativeSlugPath: (article: Article) => string
  updateArticle: (id: string, data: Partial<Article>) => Promise<Article | undefined>
  publishArticle: (article: Article, isPublished?: boolean) => Promise<void>
  addArticle: (parentId: string | null, position: 'before' | 'after' | 'child') => Promise<void>
  deleteArticle: (articleId: string) => Promise<void>
  duplicateArticle: (article: Article) => Promise<void>
  renameArticle: (articleId: string, newTitle: string) => Promise<void>
  isArticleActive: (article: Article) => boolean
  isAddingArticle: boolean
  isLoadingArticles: boolean
  isEditorLoading: boolean
  setIsEditorLoading: (isLoading: boolean) => void
  refetchArticles: () => Promise<void>
}

// Context provider component
const KnowledgeBaseContext = createContext<KnowledgeBaseContextProps | undefined>(undefined)

export function KBProvider({
  children,
  knowledgeBaseId,
  initialArticles,
}: {
  children: ReactNode
  knowledgeBaseId: string
  initialArticles: Article[]
}) {
  const utils = api.useUtils()
  const router = useRouter()
  const pathname = usePathname()

  // --- Loading States ---
  const [isAddingArticle, setIsAddingArticle] = useState(false)
  const [isEditorLoading, setIsEditorLoading] = useState(false)

  // --- Query Hooks ---
  // We'll still use the articles passed as props, but add refetching capability
  const {
    data: fetchedArticles,
    isLoading: isLoadingArticles,
    refetch: refetchArticlesQuery,
  } = api.kb.getArticles.useQuery(
    { knowledgeBaseId, includeUnpublished: true },
    {
      enabled: !!knowledgeBaseId,
      initialData: initialArticles.length > 0 ? initialArticles : undefined,
    }
  )

  // Refetch articles helper function
  const refetchArticles = useCallback(async () => {
    await refetchArticlesQuery()
  }, [refetchArticlesQuery])

  // Process initial articles to add path information
  const processedArticles = useMemo(() => {
    return generateArticlePaths(fetchedArticles || initialArticles || [])
  }, [fetchedArticles, initialArticles])

  // Store articles with path information
  const [articles, setArticles] = useState<Article[]>(processedArticles)

  // Update articles when fetched data changes
  useEffect(() => {
    if (fetchedArticles) {
      setArticles(generateArticlePaths(fetchedArticles))
    }
  }, [fetchedArticles])

  // Create the base path for KB routes
  const basePath = useMemo(() => `/app/kb/${knowledgeBaseId}`, [knowledgeBaseId])

  // Memoize article tree from flat array
  const articleTree = useMemo(() => buildArticleTree(articles), [articles])

  // Memoize article slug paths for navigation
  const articleSlugPaths = useMemo(() => {
    const paths: Record<string, string> = {}

    for (const article of articles) {
      paths[article.id] = getFullSlugPath(article, articles)
    }

    return paths
  }, [articles])

  // Helper function to flatten the article tree for navigation
  const flattenTree = useCallback((tree: Article[]): Article[] => {
    let result: Article[] = []
    for (const article of tree) {
      result.push(article)
      if (article.children && article.children.length > 0) {
        result = [...result, ...flattenTree(article.children)]
      }
    }
    return result
  }, [])

  // Get current article by ID
  const getCurrentArticle = useCallback(
    (articleId: string): Article | undefined => {
      return articles.find((article) => article.id === articleId)
    },
    [articles]
  )

  // Get previous article in the flattened list
  const getPrevArticle = useCallback(
    (article: Article): Article | undefined => {
      const flattenedArticles = flattenTree(articleTree)
      const currentIndex = flattenedArticles.findIndex((a) => a.id === article.id)
      if (currentIndex <= 0) return undefined
      return flattenedArticles[currentIndex - 1]
    },
    [articleTree, flattenTree]
  )

  // Get next article in the flattened list
  const getNextArticle = useCallback(
    (article: Article): Article | undefined => {
      const flattenedArticles = flattenTree(articleTree)
      const currentIndex = flattenedArticles.findIndex((a) => a.id === article.id)
      if (currentIndex === -1 || currentIndex >= flattenedArticles.length - 1) return undefined
      return flattenedArticles[currentIndex + 1]
    },
    [articleTree, flattenTree]
  )

  // Get full slug path for an article
  const getFullSlugPathWithQuery = useCallback(
    (article: Article, includeQuery: boolean = true): string => {
      const slugPath = articleSlugPaths[article.id] || getFullSlugPath(article, articles)
      return `${basePath}/editor/~/${slugPath}${includeQuery ? '?tab=articles' : ''}`
    },
    [articles, basePath, articleSlugPaths]
  )

  // Get relative slug path
  const getRelativeSlugPath = useCallback(
    (article: Article): string => {
      return articleSlugPaths[article.id] || getFullSlugPath(article, articles)
    },
    [articles, articleSlugPaths]
  )

  // API mutations
  const updateArticleMutation = api.kb.updateArticle.useMutation({
    onSuccess: () => {
      utils.kb.getArticles.invalidate({ knowledgeBaseId })
      toastSuccess({
        title: 'Article updated',
        description: 'The article was successfully updated.',
      })
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update article',
        description: error.message || 'An unexpected error occurred',
      })
    },
  })

  const deleteArticleMutation = api.kb.deleteArticle.useMutation()

  const publishArticleMutation = api.kb.publishArticle.useMutation({
    onSuccess: () => {
      utils.kb.getArticles.invalidate({ knowledgeBaseId })
    },
  })

  const createArticleMutation = api.kb.createArticle.useMutation({
    onSuccess: () => {
      utils.kb.getArticles.invalidate({ knowledgeBaseId })
    },
  })

  // Update article
  const updateArticle = useCallback(
    async (id: string, data: Partial<Article>) => {
      try {
        const result = await updateArticleMutation.mutateAsync({
          id,
          data,
          knowledgeBaseId,
        })
        return result
      } catch (error) {
        toastError({
          title: "Couldn't update article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, updateArticleMutation]
  )

  // Delete article with optimistic update
  const deleteArticle = useCallback(
    async (articleId: string) => {
      try {
        // Store original articles for potential UI transition
        const currentArticlesList = [...articles]

        // Optimistic UI update - remove the article and its children from the list
        const optimisticArticlesList = currentArticlesList.filter((article) => {
          // Remove the article itself
          if (article.id === articleId) return false

          // Also remove any article that has this as an ancestor (by checking path)
          if (article.path && article.path.includes(`/${articleId}/`)) return false

          return true
        })

        // Apply optimistic update to the state
        setArticles(optimisticArticlesList)

        // Call the API to actually delete the article
        await deleteArticleMutation.mutateAsync({
          id: articleId,
          knowledgeBaseId,
        })

        // Invalidate the cache to ensure fresh data on next fetch
        utils.kb.getArticles.invalidate({ knowledgeBaseId })

        // Show success message
        toastSuccess({
          title: 'Article Deleted',
          description: 'The article was successfully removed.',
        })

        // If we were viewing the deleted article, navigate away
        const currentPathname = window.location.pathname
        if (currentPathname.includes(`/editor/~`) && currentPathname.includes(articleId)) {
          // Navigate to KB root
          router.push(`/app/kb/${knowledgeBaseId}`)
        }
      } catch (error) {
        console.error('Failed to delete article:', error)
        toastError({
          title: "Couldn't delete article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })

        // Revert optimistic update by refetching data
        utils.kb.getArticles.invalidate({ knowledgeBaseId })
      }
    },
    [knowledgeBaseId, deleteArticleMutation, utils.kb.getArticles, articles, router]
  )

  // Rename article (simplified implementation)
  const renameArticle = useCallback(
    async (articleId: string, newTitle: string) => {
      try {
        await updateArticle(articleId, { title: newTitle })
        utils.kb.getArticles.invalidate({ knowledgeBaseId })
      } catch (error) {
        console.error('Failed to rename article:', error)
        toastError({
          title: "Couldn't rename article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, updateArticle, utils.kb.getArticles]
  )

  // Add article
  const addArticle = useCallback(
    async (parentId: string | null, position: 'before' | 'after' | 'child') => {
      try {
        setIsAddingArticle(true)
        setIsEditorLoading(true)

        const createData: any = { knowledgeBaseId }

        if (parentId) {
          // Get the target article
          const parentArticle = articles.find((a) => a.id === parentId)

          if (!parentArticle) {
            throw new Error('Parent article not found')
          }

          if (position === 'child') {
            // Adding as a child of the specified article
            createData.parentId = parentId
          } else if (position === 'after') {
            // Check if the target is a category with children
            const isCategory = parentArticle.isCategory
            const hasChildren = parentArticle.children && parentArticle.children.length > 0

            if (isCategory && hasChildren) {
              // For a category with children, "after" means "first child"
              createData.parentId = parentId
              createData.position = 'first_child'
            } else {
              // For a normal article or empty category, "after" means insert after it
              createData.parentId = parentArticle.parentId
              createData.adjacentTo = parentId
              createData.position = 'after'
            }
          } else {
            // 'before' position - standard behavior
            createData.parentId = parentArticle.parentId
            createData.adjacentTo = parentId
            createData.position = position
          }
        }

        // Execute the API call to create the article
        const newArticle = await createArticleMutation.mutateAsync(createData)

        if (newArticle) {
          // Prepare the path for the new article
          const articlePath = getFullSlugPathWithQuery(newArticle)

          // IMPORTANT: Add the new article to the local cache before navigation
          utils.kb.getArticles.setData({ knowledgeBaseId, includeUnpublished: true }, (oldData) => {
            if (!oldData) return [newArticle]
            return [...oldData, newArticle]
          })

          // Wait for cache invalidation to complete
          await utils.kb.getArticles.invalidate({ knowledgeBaseId })

          // Small delay to ensure the cache is updated
          await new Promise((resolve) => setTimeout(resolve, 50))

          // Navigate to the new article
          router.push(articlePath)
        }
      } catch (error) {
        console.error('Failed to create article:', error)
        toastError({
          title: "Couldn't create article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        setIsEditorLoading(false)
      } finally {
        setIsAddingArticle(false)
      }
    },
    [
      knowledgeBaseId,
      articles,
      createArticleMutation,
      router,
      getFullSlugPathWithQuery,
      utils.kb.getArticles,
    ]
  )

  // Duplicate article
  const duplicateArticle = useCallback(
    async (article: Article) => {
      try {
        setIsAddingArticle(true)
        setIsEditorLoading(true)

        if (!article) {
          throw new Error('Article not found')
        }

        const newTitle = `Copy of ${article.title}`
        const createData = {
          knowledgeBaseId,
          title: newTitle,
          content: article.content,
          contentJson: article.contentJson,
          excerpt: article.excerpt,
          emoji: article.emoji,
          isCategory: article.isCategory,
          parentId: article.parentId,
          isPublished: article.isPublished,
          status: article.status,
          tags: article.tags?.map((t) => t.tag.name) || [],
          adjacentTo: article.id,
          position: 'after' as const,
        }

        const newArticle = await createArticleMutation.mutateAsync(createData)

        if (newArticle) {
          // Add to local cache before navigation
          utils.kb.getArticles.setData({ knowledgeBaseId, includeUnpublished: true }, (oldData) => {
            if (!oldData) return [newArticle]
            return [...oldData, newArticle]
          })

          // Wait for cache invalidation
          await utils.kb.getArticles.invalidate({ knowledgeBaseId })

          // Small delay to ensure the cache is updated
          await new Promise((resolve) => setTimeout(resolve, 50))

          const articlePath = getFullSlugPathWithQuery(newArticle)
          router.push(articlePath)
        }
      } catch (error) {
        console.error('Failed to duplicate article:', error)
        toastError({
          title: "Couldn't duplicate article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        setIsEditorLoading(false)
      } finally {
        setIsAddingArticle(false)
      }
    },
    [knowledgeBaseId, createArticleMutation, router, getFullSlugPathWithQuery, utils.kb.getArticles]
  )

  // Publish/unpublish article
  const publishArticle = useCallback(
    async (article: Article, isPublished?: boolean) => {
      try {
        if (typeof isPublished === 'undefined') {
          isPublished = !article.isPublished
        }

        await publishArticleMutation.mutateAsync({
          id: article.id,
          isPublished,
        })

        toastSuccess({
          title: isPublished ? 'Article published' : 'Article unpublished',
          description: isPublished
            ? 'The article is now visible to readers'
            : 'The article is now hidden from readers',
        })
      } catch (error) {
        console.error('Failed to change article publish state:', error)
        toastError({
          title: isPublished ? "Couldn't publish article" : "Couldn't unpublish article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [publishArticleMutation]
  )

  // Check if article is active
  const checkIsArticleActive = useCallback(
    (article: Article): boolean => {
      return isArticleActive(article, pathname || '', basePath, articleSlugPaths)
    },
    [pathname, basePath, articleSlugPaths]
  )

  // Context value
  const contextValue: KnowledgeBaseContextProps = {
    articles,
    articleTree,
    getCurrentArticle,
    getPrevArticle,
    getNextArticle,
    getFullSlugPath: getFullSlugPathWithQuery, // Renamed function for clarity
    getRelativeSlugPath,
    updateArticle,
    renameArticle,
    addArticle,
    publishArticle,
    deleteArticle,
    duplicateArticle,
    isArticleActive: checkIsArticleActive,
    isAddingArticle,
    isLoadingArticles,
    isEditorLoading,
    setIsEditorLoading,
    refetchArticles,
  }

  return (
    <KnowledgeBaseContext.Provider value={contextValue}>{children}</KnowledgeBaseContext.Provider>
  )
}

// Context hook
export function useKnowledgeBase() {
  const context = useContext(KnowledgeBaseContext)
  if (context === undefined) {
    throw new Error('useKnowledgeBase must be used within a KBProvider')
  }
  return context
}

// Export Article type for reuse
export type { Article }
