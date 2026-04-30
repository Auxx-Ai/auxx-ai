// apps/web/src/components/kb/hooks/use-article-mutations.ts
'use client'

import { ArticleKind, ArticleStatus } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
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
    articleKind: (server.articleKind ?? ArticleKind.page) as ArticleKindType,
    order: server.order ?? 0,
    isPublished: !!server.isPublished,
    status: (server.status ?? ArticleStatus.DRAFT) as ArticleMeta['status'],
    description: server.description ?? null,
    excerpt: server.excerpt ?? null,
    hasUnpublishedChanges: !!server.hasUnpublishedChanges,
    publishedAt: server.publishedAt ? new Date(server.publishedAt) : null,
    publishedRevisionId: server.publishedRevisionId ?? null,
    draftRevisionId: server.draftRevisionId ?? null,
  }
}

interface CreateArticleInput {
  parentId?: string | null
  adjacentTo?: string
  position?: 'before' | 'after' | 'first_child'
  title?: string
  slug?: string
  articleKind?: ArticleKindType
  emoji?: string | null
  content?: string | null
  contentJson?: unknown
  excerpt?: string | null
  description?: string | null
}

export interface UseArticleMutationsResult {
  createArticle: (input?: CreateArticleInput) => Promise<ArticleMeta | undefined>
  /** Update title/description/excerpt/emoji on the draft revision. */
  updateArticleDraft: (
    id: string,
    fields: {
      title?: string
      description?: string | null
      excerpt?: string | null
      emoji?: string | null
    }
  ) => Promise<void>
  /** Update structural fields (slug, parentId, order). */
  updateArticleStructure: (
    id: string,
    fields: { slug?: string; parentId?: string | null; order?: number }
  ) => Promise<void>
  /** Save heavy content to the draft revision (no optimistic store update). */
  updateArticleContent: (
    id: string,
    data: { content?: string; contentJson?: unknown }
  ) => Promise<void>
  deleteArticle: (id: string) => Promise<void>
  publishArticle: (id: string) => Promise<void>
  unpublishArticle: (id: string) => Promise<void>
  archiveArticle: (id: string) => Promise<void>
  unarchiveArticle: (id: string) => Promise<void>
  discardArticleDraft: (id: string) => Promise<void>
  restoreArticleVersion: (versionId: string) => Promise<void>
  duplicateArticle: (article: ArticleMeta) => Promise<ArticleMeta | undefined>
  /** Convenience: rename via the draft (title/emoji) + structure (slug). */
  renameArticle: (
    id: string,
    fields: { title?: string; emoji?: string | null; slug?: string }
  ) => Promise<void>
  isCreating: boolean
}

export function useArticleMutations(knowledgeBaseId: string): UseArticleMutationsResult {
  const utils = api.useUtils()
  const posthog = useAnalytics()

  const createMutation = api.kb.createArticle.useMutation()
  const updateDraftMutation = api.kb.updateArticleDraft.useMutation()
  const updateStructureMutation = api.kb.updateArticleStructure.useMutation()
  const deleteMutation = api.kb.deleteArticle.useMutation()
  const publishMutation = api.kb.publishArticle.useMutation()
  const unpublishMutation = api.kb.unpublishArticle.useMutation()
  const archiveMutation = api.kb.archiveArticle.useMutation()
  const unarchiveMutation = api.kb.unarchiveArticle.useMutation()
  const discardDraftMutation = api.kb.discardArticleDraft.useMutation()
  const restoreVersionMutation = api.kb.restoreArticleVersion.useMutation()

  const createArticle = useCallback<UseArticleMutationsResult['createArticle']>(
    async (input = {}) => {
      const tempId = `temp_${generateId()}`
      const store = getArticleStoreState()
      const optimisticArticle: ArticleMeta = {
        id: tempId,
        knowledgeBaseId,
        title: input.title ?? 'Untitled',
        slug: input.slug ?? 'untitled',
        emoji: input.emoji ?? null,
        parentId: input.parentId ?? null,
        articleKind: input.articleKind ?? ArticleKind.page,
        order: 9999,
        isPublished: false,
        status: ArticleStatus.DRAFT,
        description: input.description ?? null,
        excerpt: input.excerpt ?? null,
        hasUnpublishedChanges: false,
        publishedAt: null,
        publishedRevisionId: null,
        draftRevisionId: null,
      }
      store.addOptimisticArticle(tempId, optimisticArticle)
      try {
        const server = await createMutation.mutateAsync({
          knowledgeBaseId,
          title: input.title,
          slug: input.slug,
          articleKind: input.articleKind,
          emoji: input.emoji,
          content: input.content ?? undefined,
          contentJson: input.contentJson,
          excerpt: input.excerpt ?? undefined,
          description: input.description ?? undefined,
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

  const updateArticleDraft = useCallback<UseArticleMutationsResult['updateArticleDraft']>(
    async (id, fields) => {
      const store = getArticleStoreState()
      // Sidebar shows draft fields when the article isn't yet published.
      // For published articles we leave the sidebar showing the live title.
      const current = store.articles.get(id)
      const showInSidebar = current && !current.isPublished
      if (showInSidebar) store.setArticleOptimistic(id, fields)
      try {
        const server = await updateDraftMutation.mutateAsync({ id, data: fields, knowledgeBaseId })
        const normalized = normalizeServerArticle(server)
        if (showInSidebar) store.confirmUpdate(id, normalized)
        else store.applyArticleMetadataFromServer(id, normalized)
      } catch (error) {
        if (showInSidebar) store.rollbackUpdate(id)
        toastError({
          title: "Couldn't update article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, updateDraftMutation]
  )

  const updateArticleStructure = useCallback<UseArticleMutationsResult['updateArticleStructure']>(
    async (id, fields) => {
      const store = getArticleStoreState()
      store.setArticleOptimistic(id, fields)
      try {
        const server = await updateStructureMutation.mutateAsync({
          id,
          data: fields,
          knowledgeBaseId,
        })
        store.confirmUpdate(id, normalizeServerArticle(server))
      } catch (error) {
        store.rollbackUpdate(id)
        toastError({
          title: "Couldn't update article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, updateStructureMutation]
  )

  /**
   * Save the editor's content to the draft revision. Bypasses optimistic store
   * state — heavy content isn't mirrored in the store.
   */
  const updateArticleContent = useCallback<UseArticleMutationsResult['updateArticleContent']>(
    async (id, data) => {
      try {
        const server = await updateDraftMutation.mutateAsync({
          id,
          data: data as { content?: string; contentJson?: unknown },
          knowledgeBaseId,
        })
        // Reflect the server's authoritative metadata (e.g. hasUnpublishedChanges)
        // so the sidebar/status pills don't fight a concurrent publish.
        getArticleStoreState().applyArticleMetadataFromServer(id, normalizeServerArticle(server))
      } catch (error) {
        toastError({
          title: 'Failed to save article',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, updateDraftMutation]
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
    async (id) => {
      const store = getArticleStoreState()
      store.setArticleOptimistic(id, {
        isPublished: true,
        status: ArticleStatus.PUBLISHED,
        hasUnpublishedChanges: false,
      })
      try {
        const result = await publishMutation.mutateAsync({ id, knowledgeBaseId })
        store.confirmUpdate(id, normalizeServerArticle(result.article))
        toastSuccess({
          title: 'Article published',
          description: 'The article is now visible to readers',
        })
      } catch (error) {
        store.rollbackUpdate(id)
        toastError({
          title: "Couldn't publish article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, publishMutation]
  )

  const unpublishArticle = useCallback<UseArticleMutationsResult['unpublishArticle']>(
    async (id) => {
      const store = getArticleStoreState()
      store.setArticleOptimistic(id, {
        isPublished: false,
        status: ArticleStatus.DRAFT,
      })
      try {
        const server = await unpublishMutation.mutateAsync({ id, knowledgeBaseId })
        store.confirmUpdate(id, normalizeServerArticle(server))
      } catch (error) {
        store.rollbackUpdate(id)
        toastError({
          title: "Couldn't unpublish article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, unpublishMutation]
  )

  const archiveArticle = useCallback<UseArticleMutationsResult['archiveArticle']>(
    async (id) => {
      const store = getArticleStoreState()
      store.setArticleOptimistic(id, {
        status: ArticleStatus.ARCHIVED,
        isPublished: false,
      })
      try {
        const server = await archiveMutation.mutateAsync({ id, knowledgeBaseId })
        store.confirmUpdate(id, normalizeServerArticle(server))
      } catch (error) {
        store.rollbackUpdate(id)
        toastError({
          title: "Couldn't archive article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, archiveMutation]
  )

  const unarchiveArticle = useCallback<UseArticleMutationsResult['unarchiveArticle']>(
    async (id) => {
      const store = getArticleStoreState()
      store.setArticleOptimistic(id, {
        status: ArticleStatus.DRAFT,
        isPublished: false,
      })
      try {
        const server = await unarchiveMutation.mutateAsync({ id, knowledgeBaseId })
        store.confirmUpdate(id, normalizeServerArticle(server))
      } catch (error) {
        store.rollbackUpdate(id)
        toastError({
          title: "Couldn't unarchive article",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, unarchiveMutation]
  )

  const discardArticleDraft = useCallback<UseArticleMutationsResult['discardArticleDraft']>(
    async (id) => {
      try {
        const server = await discardDraftMutation.mutateAsync({ id, knowledgeBaseId })
        getArticleStoreState().applyArticleFromServer(normalizeServerArticle(server))
        utils.kb.getArticleById.invalidate({ id, knowledgeBaseId })
      } catch (error) {
        toastError({
          title: "Couldn't discard draft",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, discardDraftMutation, utils.kb.getArticleById]
  )

  const restoreArticleVersion = useCallback<UseArticleMutationsResult['restoreArticleVersion']>(
    async (versionId) => {
      try {
        const server = await restoreVersionMutation.mutateAsync({ versionId })
        const normalized = normalizeServerArticle(server)
        getArticleStoreState().applyArticleFromServer(normalized)
        utils.kb.getArticleById.invalidate({ id: normalized.id, knowledgeBaseId })
        toastSuccess({
          title: 'Version restored',
          description: 'The version has been loaded into your draft.',
        })
      } catch (error) {
        toastError({
          title: "Couldn't restore version",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [knowledgeBaseId, restoreVersionMutation, utils.kb.getArticleById]
  )

  const duplicateArticle = useCallback<UseArticleMutationsResult['duplicateArticle']>(
    async (article) => {
      return await createArticle({
        title: `Copy of ${article.title}`,
        emoji: article.emoji,
        articleKind: article.articleKind,
        parentId: article.parentId,
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
      const draftFields: {
        title?: string
        emoji?: string | null
      } = {}
      if (fields.title !== undefined) draftFields.title = fields.title
      if (fields.emoji !== undefined) draftFields.emoji = fields.emoji
      if (Object.keys(draftFields).length > 0) {
        await updateArticleDraft(id, draftFields)
      }
      if (fields.slug !== undefined) {
        await updateArticleStructure(id, { slug: fields.slug })
      }
    },
    [updateArticleDraft, updateArticleStructure]
  )

  return {
    createArticle,
    updateArticleDraft,
    updateArticleStructure,
    updateArticleContent,
    deleteArticle,
    publishArticle,
    unpublishArticle,
    archiveArticle,
    unarchiveArticle,
    discardArticleDraft,
    restoreArticleVersion,
    duplicateArticle,
    renameArticle,
    isCreating: createMutation.isPending,
  }
}
