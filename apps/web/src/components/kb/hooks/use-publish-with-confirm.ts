// apps/web/src/components/kb/hooks/use-publish-with-confirm.ts
'use client'

import { ArticleKind } from '@auxx/database/enums'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import type { ArticleMeta } from '../store/article-store'
import { countPublishedDescendants, getUnpublishedAncestors } from '../utils/publish-impact'
import { useArticleList } from './use-article-list'
import { useArticleMutations } from './use-article-mutations'

interface PublishConfirmFlow {
  /** Open the cascade dialog if needed, then publish leaf + any ancestors. */
  requestPublish: (article: ArticleMeta) => Promise<void>
  /** Open the impact dialog if `article` is a tab/header with published descendants, then unpublish. */
  requestUnpublish: (article: ArticleMeta) => Promise<void>
  /** Render once per consumer to mount the underlying confirm dialog. */
  ConfirmDialog: () => React.JSX.Element
}

function kindLabel(kind: ArticleMeta['articleKind']): string {
  if (kind === ArticleKind.tab) return 'tab'
  if (kind === ArticleKind.header) return 'category'
  if (kind === ArticleKind.category) return 'category'
  return 'page'
}

function formatList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function buildCascadeDescription(ancestors: ArticleMeta[]): string {
  const labelled = ancestors.map((a) => `'${a.title}' (${kindLabel(a.articleKind)})`)
  const list = formatList(labelled)
  const noun = ancestors.length === 1 ? 'it' : 'these'
  const base = `This will also publish ${list}. Without ${noun}, your article won't appear on the public site.`

  const unsaved = ancestors.filter((a) => a.hasUnpublishedChanges).map((a) => `'${a.title}'`)
  if (unsaved.length === 0) return base
  return `${base} Includes unsaved changes to ${formatList(unsaved)}.`
}

export function usePublishWithConfirm(knowledgeBaseId: string): PublishConfirmFlow {
  const articles = useArticleList(knowledgeBaseId)
  const { publishArticle, unpublishArticle } = useArticleMutations(knowledgeBaseId)
  const [confirm, ConfirmDialog] = useConfirm()

  const requestPublish = useCallback<PublishConfirmFlow['requestPublish']>(
    async (article) => {
      const { ancestors, archivedAncestor } = getUnpublishedAncestors(article.id, articles)
      if (archivedAncestor) {
        toastError({
          title: "Can't publish",
          description: `'${archivedAncestor.title}' is archived. Unarchive it before publishing this article.`,
        })
        return
      }
      if (ancestors.length === 0) {
        await publishArticle(article.id)
        return
      }
      const ok = await confirm({
        title: `Publish '${article.title}'?`,
        description: buildCascadeDescription(ancestors),
        confirmText: 'Publish all',
      })
      if (!ok) return
      await publishArticle(
        article.id,
        ancestors.map((a) => a.id)
      )
    },
    [articles, confirm, publishArticle]
  )

  const requestUnpublish = useCallback<PublishConfirmFlow['requestUnpublish']>(
    async (article) => {
      const isContainer =
        article.articleKind === ArticleKind.tab || article.articleKind === ArticleKind.header
      if (isContainer) {
        const count = countPublishedDescendants(article.id, articles)
        if (count > 0) {
          const noun = count === 1 ? 'article' : 'articles'
          const ok = await confirm({
            title: `Unpublish '${article.title}'?`,
            description: `This ${kindLabel(article.articleKind)} contains ${count} published ${noun}. Unpublishing hides ${count === 1 ? 'it' : 'them'} on the public site, but ${count === 1 ? 'it stays' : 'they stay'} published — ${count === 1 ? 'it will' : 'they will'} re-appear when you republish '${article.title}'.`,
            confirmText: 'Unpublish',
          })
          if (!ok) return
        }
      }
      await unpublishArticle(article.id)
    },
    [articles, confirm, unpublishArticle]
  )

  return { requestPublish, requestUnpublish, ConfirmDialog }
}
