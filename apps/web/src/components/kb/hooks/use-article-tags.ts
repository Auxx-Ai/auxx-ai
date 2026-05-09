// apps/web/src/components/kb/hooks/use-article-tags.ts

import { toRecordId } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { useResource, useSystemField } from '~/components/resources/hooks'
import { api } from '~/trpc/react'
import { getArticleStoreState } from '../store/article-store'
import { useArticle } from './use-article'

/**
 * Hook for managing article tags with optimistic updates to ArticleStore.
 * Mirrors `useThreadTags` but writes to the article store and uses the
 * article entity definition.
 *
 * @param articleId The article ID to manage tags for
 * @returns Tag state and operations: { selectedTags, handleTagChange, isPending }
 */
export function useArticleTags(articleId: string) {
  const article = useArticle(articleId)

  const { resource: articleResource } = useResource('article')
  const articleEntityDefId = articleResource?.entityDefinitionId ?? null

  const tagsField = useSystemField('article_tags')
  const tagsFieldId = tagsField?.id ?? null

  const mutation = api.fieldValue.set.useMutation()

  const selectedTags: RecordId[] = article?.tagIds ?? []

  const handleTagChange = useCallback(
    (incomingTagIds: RecordId[]) => {
      if (!article || !articleEntityDefId || !tagsFieldId) {
        console.warn('Cannot update tags: missing article, entity definition ID, or tags field')
        return
      }

      const newTagIds = incomingTagIds.filter(Boolean)
      const store = getArticleStoreState()
      store.setArticleOptimistic(articleId, { tagIds: newTagIds })

      const articleRecordId = toRecordId(articleEntityDefId, article.id)

      mutation.mutate(
        {
          recordId: articleRecordId,
          fieldId: tagsFieldId,
          value: newTagIds,
        },
        {
          onSuccess: () => {
            getArticleStoreState().confirmUpdate(articleId)
          },
          onError: (error) => {
            getArticleStoreState().rollbackUpdate(articleId)
            toastError({
              title: 'Failed to update tags',
              description: error.message,
            })
          },
        }
      )
    },
    [article, articleId, articleEntityDefId, tagsFieldId, mutation]
  )

  return {
    selectedTags,
    handleTagChange,
    isPending: mutation.isPending,
  }
}
