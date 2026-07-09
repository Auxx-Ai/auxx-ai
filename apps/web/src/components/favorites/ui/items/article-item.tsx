// apps/web/src/components/favorites/ui/items/article-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { EntityIcon, getIcon } from '@auxx/ui/components/icons'
import { FileText, FolderClosed, Link2 } from 'lucide-react'
import { useFavoriteArticle } from '../../hooks/use-favorite-article'
import { FavoriteItemRow } from '../favorite-item-row'
import { FavoriteItemSkeleton } from '../favorite-item-skeleton'
import { PrivateItem } from '../private-item'

export function ArticleItem({ favorite }: { favorite: FavoriteEntity<'ARTICLE'> }) {
  const ids = favorite.targetIds
  const { article, slugPath, isLoading, isNotFound } = useFavoriteArticle(
    ids?.articleId,
    ids?.knowledgeBaseId
  )

  if (isNotFound) return <PrivateItem favoriteId={favorite.id} />
  if (isLoading || !article || !ids) return <FavoriteItemSkeleton favoriteId={favorite.id} />

  const hasCustomIcon = !!article.emoji && !!getIcon(article.emoji)
  const isCategory = article.articleKind === 'category'
  const icon = hasCustomIcon ? (
    <EntityIcon iconId={article.emoji as string} variant='bare' size='sm' />
  ) : isCategory ? (
    <FolderClosed />
  ) : article.articleKind === 'link' ? (
    <Link2 />
  ) : (
    <FileText />
  )

  const href = `/app/kb/${ids.knowledgeBaseId}/editor/~/${slugPath}?panel=articles`
  const subtitle = isCategory ? 'Category' : 'Article'

  return (
    <FavoriteItemRow
      favoriteId={favorite.id}
      icon={icon}
      title={article.title || 'Untitled'}
      subtitle={subtitle}
      href={href}
    />
  )
}
