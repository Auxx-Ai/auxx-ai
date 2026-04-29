// apps/web/src/components/kb/hooks/use-article-mutations.ts
'use client'

import { ArticleStatus } from '@auxx/database/enums'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { useCallback } from 'react'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'
import { type ArticleMeta, getArticleStoreState } from '../store/article-store'

/** Normalize a server article (from tRPC) into ArticleMeta. */
function normalizeServerArticle(server: any): ArticleMeta {
  return {
    id: server.id,
    knowledgeBaseId: server.knowledgeBaseId,
    title: server.title ?? '',
    slug: server.slug ?? '',
    emoji: server.emoji ?? null,
    parentId: server.parentId ?? null,
    isCategory: !!server.isCategory,
    order: server.order ?? 0,
    isPublished: !!server.isPublished,
    status: (server.status ?? ArticleStatus.DRAFT) as ArticleMeta['status'],
    description: server.description ?? null,
    excerpt: server.excerpt ?? null,
  }
}

interface CreateArticleInput {
  parentId?: string | null
  adjacentTo?: string
  position?: 'before' | 'after' | 'first_child'
  title?: string
  slug?: string
  isCategory?: boolean
  emoji?: string | null
  content?: string | null
  contentJson?: unknown
  excerpt?: string | null
  description?: string | null
  isPublished?: boolean
  status?: ArticleMeta['status']
}

export interface UseArticleMutationsResult {
  createArticle: (input?: CreateArticleInput) => Promise<ArticleMeta | undefined>
  updateArticle: (id: string, updates: Partial<ArticleMeta>) => Promise<void>
  /** Used by the editor for content saves (no optimistic store update). */
  updateArticleContent: (
    id: string,
    data: { content?: string; contentJson?: unknown }
  ) => Promise<void>
  deleteArticle: (id: string) => Promise<void>
  publishArticle: (id: string, isPublished: boolean) => Promise<void>
  duplicateArticle: (article: ArticleMeta) => Promise<ArticleMeta | undefined>
  renameArticle: (
    id: string,
    fields: { title: string; emoji?: string | null; slug?: string }
  ) => Promise<void>
  isCreating: boolean
}

export function useArticleMutations(knowledgeBaseId: string): UseArticleMutationsResult {
  const utils = api.useUtils()
  const posthog = useAnalytics()

  const createMutation = api.kb.createArticle.useMutation()
  const updateMutation = api.kb.updateArticle.useMutation()
  const deleteMutation = api.kb.deleteArticle.useMutation()
  const publishMutation = api.kb.publishArticle.useMutation()

  const createArticle = useCallback<UseArticleMutationsResult['createArticle']>(
    async (input = {}) => {
      const tempId = `temp_${generateId()}`
      const store = getArticleStoreState()

      // Build optimistic metadata. Title/slug fall back to "Untitled".
      const optimisticArticle: ArticleMeta = {
        id: tempId,
        knowledgeBaseId,
        title: input.title ?? 'Untitled',
        slug: input.slug ?? 'untitled',
        emoji: input.emoji ?? null,
        parentId: input.parentId ?? null,
        isCategory: input.isCategory ?? false,
        order: 9999, // Will be reconciled when the server returns
        isPublished: input.isPublished ?? false,
        status: input.status ?? ArticleStatus.DRAFT,
        description: input.description ?? null,
        excerpt: input.excerpt ?? null,
      }
      store.addOptimisticArticle(tempId, optimisticArticle)

      try {
        const server = await createMutation.mutateAsync({
          knowledgeBaseId,
          title: input.title,
          slug: input.slug,
          isCategory: input.isCategory,
          emoji: input.emoji,
          content: input.content ?? undefined,
          contentJson: input.contentJson,
          excerpt: input.excerpt ?? undefined,
          description: input.description ?? undefined,
          isPublished: input.isPublished,
          status: input.status,
          parentId: input.parentId ?? undefined,
          adjacentTo: input.adjacentTo,
          position: input.position as any,
        })
        const normalized = normalizeServerArticle(server)
        store.confirmCreate(tempId, normalized)
        utils.kb.getArticles.invalidate({ knowledgeBaseId })
        posthog?.capture('kb_article_created', { knowledge_base_id: knowledgeBaseId })
        return normalized
      } catch (error) {
        store.rollbackCreate(tempId)
        toastError({
          title: "Couldn't create article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return undefined
      }
    },
    [knowledgeBaseId, createMutation, utils.kb.getArticles, posthog]
  )

  const updateArticle = useCallback<UseArticleMutationsResult['updateArticle']>(
    async (id, updates) => {
      const store = getArticleStoreState()
      store.setArticleOptimistic(id, updates)
      try {
        const server = await updateMutation.mutateAsync({ id, data: updates, knowledgeBaseId })
        store.confirmUpdate(id, normalizeServerArticle(server))
      } catch (error) {
        store.rollbackUpdate(id)
        toastError({
          title: "Couldn't update article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, updateMutation]
  )

  /**
   * Save heavy content (HTML/JSON) to the server.
   * Bypasses store optimistic state — content isn't mirrored in the store.
   * Metadata (title/description/etc.) returned in the response is reconciled.
   */
  const updateArticleContent = useCallback<UseArticleMutationsResult['updateArticleContent']>(
    async (id, data) => {
      try {
        const server = await updateMutation.mutateAsync({
          id,
          data: data as any,
          knowledgeBaseId,
        })
        const normalized = normalizeServerArticle(server)
        getArticleStoreState().applyArticleMetadataFromServer(id, {
          title: normalized.title,
          slug: normalized.slug,
          emoji: normalized.emoji,
          isPublished: normalized.isPublished,
          status: normalized.status,
          description: normalized.description,
          excerpt: normalized.excerpt,
        })
      } catch (error) {
        toastError({
          title: 'Failed to save article',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, updateMutation]
  )

  const deleteArticle = useCallback<UseArticleMutationsResult['deleteArticle']>(
    async (id) => {
      const store = getArticleStoreState()
      store.markArticleDeleted(id)
      try {
        await deleteMutation.mutateAsync({ id, knowledgeBaseId })
        store.confirmDelete(id)
        utils.kb.getArticles.invalidate({ knowledgeBaseId })
        toastSuccess({
          title: 'Article Deleted',
          description: 'The article was successfully removed.',
        })
      } catch (error) {
        store.rollbackDelete(id)
        toastError({
          title: "Couldn't delete article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, deleteMutation, utils.kb.getArticles]
  )

  const publishArticle = useCallback<UseArticleMutationsResult['publishArticle']>(
    async (id, isPublished) => {
      const store = getArticleStoreState()
      store.setArticleOptimistic(id, { isPublished })
      try {
        await publishMutation.mutateAsync({ id, knowledgeBaseId, isPublished })
        store.confirmUpdate(id)
        toastSuccess({
          title: isPublished ? 'Article published' : 'Article unpublished',
          description: isPublished
            ? 'The article is now visible to readers'
            : 'The article is now hidden from readers',
        })
      } catch (error) {
        store.rollbackUpdate(id)
        toastError({
          title: isPublished ? "Couldn't publish article" : "Couldn't unpublish article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, publishMutation]
  )

  const duplicateArticle = useCallback<UseArticleMutationsResult['duplicateArticle']>(
    async (article) => {
      return await createArticle({
        title: `Copy of ${article.title}`,
        emoji: article.emoji,
        isCategory: article.isCategory,
        parentId: article.parentId,
        isPublished: article.isPublished,
        status: article.status,
        excerpt: article.excerpt,
        description: article.description,
        adjacentTo: article.id,
        position: 'after',
      })
    },
    [createArticle]
  )

  const renameArticle = useCallback<UseArticleMutationsResult['renameArticle']>(
    async (id, fields) => {
      await updateArticle(id, fields)
    },
    [updateArticle]
  )

  return {
    createArticle,
    updateArticle,
    updateArticleContent,
    deleteArticle,
    publishArticle,
    duplicateArticle,
    renameArticle,
    isCreating: createMutation.isPending,
  }
}
